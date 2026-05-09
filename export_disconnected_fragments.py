import re
from io import BytesIO


def _autosize_columns(sheet):
    for column_cells in sheet.columns:
        values = [str(cell.value) if cell.value is not None else "" for cell in column_cells]
        width = max((len(value) for value in values), default=0) + 2
        sheet.column_dimensions[column_cells[0].column_letter].width = min(max(width, 12), 42)


def _normalize_tower_name(value):
    text = str(value or "").strip().upper()
    if not text:
        return ""

    text = text.split()[0]
    if "-" in text:
        first = text.split("-", 1)[0]
        if first.startswith("TAL") or first.startswith("ALG") or first.startswith("MNZ"):
            text = first

    text = re.sub(r"-\d+$", "", text)
    return text.strip()


def _build_tower_coordinate_lookup(towers):
    lookup = {}
    for tower in towers or []:
        name = str(tower.get("name") or "").strip()
        lat = tower.get("lat")
        lon = tower.get("lon")

        if not name:
            continue
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            continue

        entry = {"name": name, "lat": lat, "lon": lon}
        lookup.setdefault(name.upper(), entry)
        normalized = _normalize_tower_name(name)
        if normalized and normalized not in lookup:
            lookup[normalized] = entry
    return lookup


def _resolve_fragment_towers(fragment, tower_lookup):
    resolved = []
    unresolved = []
    seen = set()

    for tower_name in fragment.get("node_names", []) or []:
        cleaned = str(tower_name or "").strip()
        if not cleaned:
            continue
        dedupe_key = cleaned.upper()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        normalized = _normalize_tower_name(cleaned)
        tower_entry = tower_lookup.get(cleaned.upper()) or tower_lookup.get(normalized)
        if tower_entry:
            resolved.append({
                "name": tower_entry["name"],
                "lat": tower_entry["lat"],
                "lon": tower_entry["lon"],
            })
        else:
            unresolved.append(cleaned)

    return resolved, unresolved


def _distance_sq(a, b):
    return ((a["lat"] - b["lat"]) ** 2) + ((a["lon"] - b["lon"]) ** 2)


def _build_spatial_chain(resolved_towers):
    if len(resolved_towers) <= 1:
        return list(resolved_towers)

    start_tower = max(
        resolved_towers,
        key=lambda tower: min(
            (_distance_sq(tower, other) for other in resolved_towers if other is not tower),
            default=0.0,
        ),
    )

    chain = [start_tower]
    remaining = [tower for tower in resolved_towers if tower is not start_tower]

    while remaining:
        current = chain[-1]
        next_tower = min(remaining, key=lambda tower: _distance_sq(current, tower))
        chain.append(next_tower)
        remaining.remove(next_tower)

    return chain


def _build_fragment_fallback_rows(fragment, tower_lookup):
    resolved_towers, unresolved_towers = _resolve_fragment_towers(fragment, tower_lookup)
    ordered_names = [tower["name"] for tower in _build_spatial_chain(resolved_towers)]
    standalone = []
    rows = []
    anchor_name = str(fragment.get("anchor_name") or "").strip()

    if len(ordered_names) == 1:
        standalone.append(ordered_names[0])
    elif len(ordered_names) > 1:
        rows.extend({
            "from_pol": ordered_names[idx],
            "to_pol": ordered_names[idx + 1],
            "disconnected_pole": "",
            "row_type": "relationship",
            "structure_source": "fallback",
            "notes": f"Spatial fallback ordering from fragment geometry.{f' Closest confirmed tower: {anchor_name}.' if anchor_name else ''}",
        } for idx in range(len(ordered_names) - 1))

    standalone.extend(unresolved_towers)
    rows.extend({
        "from_pol": "",
        "to_pol": "",
        "disconnected_pole": pole_name,
        "row_type": "standalone",
        "structure_source": "fallback_unresolved",
        "notes": f"Could not resolve this tower to feeder coordinates.{f' Closest confirmed tower: {anchor_name}.' if anchor_name else ''}",
    } for pole_name in standalone if pole_name)
    return rows


def _build_fragment_rows(fragment, tower_lookup):
    rows = []
    seen_pairs = set()
    seen_standalone = set()
    anchor_name = str(fragment.get("anchor_name") or "").strip()
    structure_source = str(fragment.get("structure_source") or "fragment_connectivity").strip()
    relationship_source = "fallback" if structure_source == "distance_fallback" else "connectivity"

    for relationship in fragment.get("relationships", []) or []:
        from_name = str(relationship.get("from") or "").strip()
        to_name = str(relationship.get("to") or "").strip()
        if not from_name and not to_name:
            continue
        normalized_pair = tuple(sorted([from_name.upper(), to_name.upper()]))
        pair_key = normalized_pair if all(normalized_pair) else (from_name.upper(), to_name.upper())
        if pair_key in seen_pairs:
            continue
        seen_pairs.add(pair_key)
        rows.append({
            "from_pol": from_name,
            "to_pol": to_name,
            "disconnected_pole": "",
            "row_type": "relationship",
            "structure_source": relationship_source,
            "notes": f"Relationship exported from fragment structure.{f' Closest confirmed tower: {anchor_name}.' if anchor_name else ''}" if relationship_source == "connectivity" else f"Distance-based fallback relationship.{f' Closest confirmed tower: {anchor_name}.' if anchor_name else ''}",
        })

    for pole_name in fragment.get("standalone_poles", []) or []:
        cleaned = str(pole_name or "").strip()
        normalized = cleaned.upper()
        if not cleaned or normalized in seen_standalone:
            continue
        seen_standalone.add(normalized)
        rows.append({
            "from_pol": "",
            "to_pol": "",
            "disconnected_pole": cleaned,
            "row_type": "standalone",
            "structure_source": relationship_source,
            "notes": f"Standalone disconnected pole.{f' Closest confirmed tower: {anchor_name}.' if anchor_name else ''}",
        })

    if rows:
        return rows

    return _build_fragment_fallback_rows(fragment, tower_lookup)


def build_disconnected_fragments_workbook(disconnected_fragments, towers=None):
    try:
        from openpyxl import Workbook
    except Exception as exc:
        raise ValueError("XLSX export support is missing. Run: pip install openpyxl") from exc

    if not disconnected_fragments:
        raise ValueError("There are no disconnected fragments to export.")

    tower_lookup = _build_tower_coordinate_lookup(towers or [])

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Disconnected Fragments"
    sheet.append(["Fragment ID", "From Pol", "To Pol", "Disconnected Pole", "Row Type", "Source", "Closest Confirmed Tower", "Notes"])

    for fragment in disconnected_fragments:
        fragment_id = fragment.get("fragment_id", "")
        anchor_name = str(fragment.get("anchor_name") or "").strip()
        for row in _build_fragment_rows(fragment, tower_lookup):
            sheet.append([
                fragment_id,
                row.get("from_pol", ""),
                row.get("to_pol", ""),
                row.get("disconnected_pole", ""),
                row.get("row_type", ""),
                row.get("structure_source", ""),
                anchor_name,
                row.get("notes", ""),
            ])

    _autosize_columns(sheet)
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output
