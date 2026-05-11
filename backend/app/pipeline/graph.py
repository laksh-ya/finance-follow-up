"""LangGraph pipeline wiring."""
from __future__ import annotations

from langgraph.graph import END, StateGraph

from app.models.langgraph_state import InvoiceState, initial_state
from app.pipeline.nodes import (
    build_prompt_node,
    call_llm_node,
    classify_stage_node,
    confidence_check_node,
    dispatch_email_node,
    fallback_template_node,
    human_queue_node,
    load_invoice_node,
    validate_output_node,
    write_audit_node,
)


def _route_after_classify(state: InvoiceState) -> str:
    return "human_queue" if state["stage"] == 0 else "build_prompt"


def _route_after_validation(state: InvoiceState) -> str:
    """Pure routing function — never mutates state."""
    if not state.get("validation_errors"):
        return "confidence_check"
    # retry_count is already incremented in validate_output_node
    if state.get("retry_count", 0) <= 2:
        return "build_prompt"
    return "fallback_template"


def _route_after_confidence(state: InvoiceState) -> str:
    return "human_queue" if state.get("requires_human") else "dispatch_email"


def build_pipeline():
    graph = StateGraph(InvoiceState)
    graph.add_node("load_invoice", load_invoice_node)
    graph.add_node("classify_stage", classify_stage_node)
    graph.add_node("build_prompt", build_prompt_node)
    graph.add_node("call_llm", call_llm_node)
    graph.add_node("validate_output", validate_output_node)
    graph.add_node("confidence_check", confidence_check_node)
    graph.add_node("dispatch_email", dispatch_email_node)
    graph.add_node("human_queue", human_queue_node)
    graph.add_node("fallback_template", fallback_template_node)
    graph.add_node("write_audit", write_audit_node)

    graph.set_entry_point("load_invoice")
    graph.add_edge("load_invoice", "classify_stage")
    graph.add_conditional_edges(
        "classify_stage", _route_after_classify,
        {"human_queue": "human_queue", "build_prompt": "build_prompt"},
    )
    graph.add_edge("build_prompt", "call_llm")
    graph.add_edge("call_llm", "validate_output")
    graph.add_conditional_edges(
        "validate_output", _route_after_validation,
        {
            "confidence_check": "confidence_check",
            "build_prompt": "build_prompt",
            "fallback_template": "fallback_template",
        },
    )
    graph.add_conditional_edges(
        "confidence_check", _route_after_confidence,
        {"human_queue": "human_queue", "dispatch_email": "dispatch_email"},
    )
    graph.add_edge("dispatch_email", "write_audit")
    graph.add_edge("human_queue", "write_audit")
    graph.add_edge("fallback_template", "write_audit")
    graph.add_edge("write_audit", END)

    return graph.compile()


_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = build_pipeline()
    return _pipeline


def run_for_invoice(invoice_id: str, *, tone_override: int | None = None) -> dict:
    state = initial_state(invoice_id)
    if tone_override and 1 <= tone_override <= 4:
        state["tone_override"] = tone_override
    return get_pipeline().invoke(state, config={"recursion_limit": 10})
