import calendar
from datetime import datetime


DEFAULT_DSM_RATE = 2.0148


def _safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_datetime(date_text, time_text):
    date_text = str(date_text or "").strip()
    time_text = str(time_text or "").strip()
    if not date_text:
        return None
    if not time_text:
        time_text = "00:00"

    for pattern in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(f"{date_text} {time_text}", pattern)
        except ValueError:
            continue
    return None


def compute_outage_metrics(start_date, start_time, end_date, end_time, matched_rows, dsm_rate=DEFAULT_DSM_RATE):
    warnings = []
    start_dt = _parse_datetime(start_date, start_time)
    end_dt = _parse_datetime(end_date, end_time)

    outage_duration_minutes = 0
    days_in_month = 0
    if start_dt:
        days_in_month = calendar.monthrange(start_dt.year, start_dt.month)[1]
    if start_dt and end_dt:
        outage_duration_minutes = max(0, int((end_dt - start_dt).total_seconds() // 60))
        if end_dt <= start_dt:
            warnings.append("Outage duration was zero or negative, so outage loss was clamped to 0.")
    elif start_dt:
        warnings.append("Outage end date/time was incomplete, so outage duration was treated as 0.")
    else:
        warnings.append("Outage start date/time was invalid, so outage duration was treated as 0.")

    usable_rows = [row for row in (matched_rows or []) if any(str(row.get(key) or "").strip() for key in ("pol_id", "account_number", "frombus_id", "tobus_id"))]
    total_affected_kwhr = round(sum(_safe_float(row.get("kwhr"), 0.0) for row in usable_rows), 4)
    affected_count = len(usable_rows)

    if not days_in_month or not total_affected_kwhr or not outage_duration_minutes:
        kwhr_loss_per_duration = 0.0
        kwhr_loss_php = 0.0
    else:
        kwhr_loss_per_duration = (((total_affected_kwhr / days_in_month) / 24) / 60) * outage_duration_minutes
        kwhr_loss_php = kwhr_loss_per_duration * dsm_rate

    return {
        "total_affected_kwhr": round(total_affected_kwhr, 4),
        "affected_count": affected_count,
        "outage_duration_minutes": outage_duration_minutes,
        "days_in_month": days_in_month,
        "dsm_rate": round(_safe_float(dsm_rate, DEFAULT_DSM_RATE), 4),
        "kwhr_loss_per_duration": round(kwhr_loss_per_duration, 4),
        "kwhr_loss_php": round(kwhr_loss_php, 4),
        "validation_warnings": warnings,
    }


def create_interruption_payload(payload):
    name = str(payload.get("name") or "").strip()
    start_date = str(payload.get("start_date") or "").strip()
    start_time = str(payload.get("start_time") or "").strip()
    end_date = str(payload.get("end_date") or "").strip()
    end_time = str(payload.get("end_time") or "").strip()

    if not name:
        name = f"Interruption {datetime.now().strftime('%Y%m%d-%H%M%S')}"

    if not start_date:
        start_date = datetime.now().strftime("%Y-%m-%d")

    if not start_time:
        start_time = datetime.now().strftime("%H:%M")

    if not end_date:
        end_date = start_date

    if not end_time:
        end_time = start_time

    matched_rows = list(payload.get("matched_rows") or [])
    metrics = compute_outage_metrics(
        start_date,
        start_time,
        end_date,
        end_time,
        matched_rows,
        dsm_rate=payload.get("dsm_rate", DEFAULT_DSM_RATE),
    )

    return {
        "name": name,
        "start_date": start_date,
        "start_time": start_time,
        "end_date": end_date,
        "end_time": end_time,
        "target_name": str(payload.get("target_name") or "").strip(),
        "context_type": str(payload.get("context_type") or "tower").strip() or "tower",
        "source_tower_clicked": str(payload.get("source_tower_clicked") or "").strip(),
        "total_affected_towers": _safe_int(payload.get("total_affected_towers"), len(list(payload.get("affected_towers") or []))),
        "total_affected_accounts": _safe_int(payload.get("total_affected_accounts"), metrics["affected_count"]),
        "timestamp": str(payload.get("timestamp") or "").strip(),
        "user": str(payload.get("user") or "Pending User").strip() or "Pending User",
        "feeder_name": str(payload.get("feeder_name") or "").strip(),
        "total_transformers": _safe_int(payload.get("total_transformers") or 0),
        "trace_confidence": str(payload.get("trace_confidence") or "confirmed").strip() or "confirmed",
        "inferred_edges_used": list(payload.get("inferred_edges_used") or []),
        "inferred_nodes_count": _safe_int(payload.get("inferred_nodes_count") or 0),
        "inferred_accounts_count": _safe_int(payload.get("inferred_accounts_count") or 0),
        "affected_towers": list(payload.get("affected_towers") or []),
        "matched_rows": matched_rows,
        "line_indexes": list(payload.get("line_indexes") or []),
        "kml_feature": payload.get("kml_feature") or None,
        "total_affected_kwhr": metrics["total_affected_kwhr"],
        "outage_duration_minutes": metrics["outage_duration_minutes"],
        "days_in_month": metrics["days_in_month"],
        "dsm_rate": metrics["dsm_rate"],
        "kwhr_loss_per_duration": metrics["kwhr_loss_per_duration"],
        "kwhr_loss_php": metrics["kwhr_loss_php"],
        "validation_warnings": metrics["validation_warnings"],
    }
