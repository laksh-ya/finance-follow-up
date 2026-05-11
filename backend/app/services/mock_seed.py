"""Seed synthetic invoices spanning every escalation stage."""
from __future__ import annotations

import logging
from datetime import date, timedelta

from app.db import repos
from app.models.enums import InvoiceStatus, days_overdue_to_stage
from app.models.invoice import InvoiceRecord

log = logging.getLogger(__name__)

SEED: list[dict] = [
    # (days_overdue, invoice_no, client, amount, currency, status)
    {"days": 2, "no": 1, "name": "Rajesh Kumar", "email": "rajesh@acmecorp.in", "amt": 45000, "cur": "INR"},
    {"days": 5, "no": 2, "name": "Priya Sharma", "email": "priya@nimbustech.com", "amt": 128500, "cur": "INR"},
    {"days": 10, "no": 3, "name": "Aarav Patel", "email": "aarav@velocitygroup.io", "amt": 72000, "cur": "INR"},
    {"days": 12, "no": 4, "name": "Sneha Iyer", "email": "sneha@orbitexports.co", "amt": 255000, "cur": "INR"},
    {"days": 17, "no": 5, "name": "Vikram Singh", "email": "vikram@trinityholdings.in", "amt": 98000, "cur": "INR"},
    {"days": 19, "no": 6, "name": "Kavya Reddy", "email": "kavya@polarislabs.com", "amt": 410000, "cur": "INR"},
    {"days": 24, "no": 7, "name": "Arjun Mehta", "email": "arjun@apexsolutions.co", "amt": 63000, "cur": "INR"},
    {"days": 28, "no": 8, "name": "Ishita Verma", "email": "ishita@quantumworks.in", "amt": 187500, "cur": "INR"},
    {"days": 34, "no": 9, "name": "Rohan Desai", "email": "rohan@helixmedia.co", "amt": 305000, "cur": "INR"},
    {"days": 42, "no": 10, "name": "Anika Bose", "email": "anika@summitretail.in", "amt": 524000, "cur": "INR"},
    # one already-paid (so dashboards show paid count)
    {"days": 3, "no": 11, "name": "Dev Kapoor", "email": "dev@brightforge.io", "amt": 88000, "cur": "INR", "status": InvoiceStatus.PAID},
    # one disputed
    {"days": 9, "no": 12, "name": "Meera Nair", "email": "meera@coastalventures.co", "amt": 142000, "cur": "INR", "status": InvoiceStatus.DISPUTED},
]


def seed_invoices(year: int = 2025) -> int:
    today = date.today()
    count = 0
    for row in SEED:
        due = today - timedelta(days=row["days"])
        invoice_id = f"INV-{year}-{row['no']:03d}"
        record = InvoiceRecord(
            invoice_id=invoice_id,
            client_name=row["name"],
            client_email=row["email"],
            amount=float(row["amt"]),
            currency=row["cur"],
            due_date=due,
            days_overdue=row["days"],
            followup_count=0,
            stage=days_overdue_to_stage(row["days"]),
            status=row.get("status", InvoiceStatus.ACTIVE),
            payment_link=f"https://pay.example.com/{invoice_id.lower()}",
            notes=None,
        )
        repos.upsert_invoice(record)
        count += 1
    repos.push_activity("seed", f"Seeded {count} mock invoices", level="info")
    log.info("Seeded %d mock invoices", count)
    return count
