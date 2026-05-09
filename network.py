import re
from collections import deque


POLE_ID_PATTERN = re.compile(r"\b(?:SDO|TAL|ALG|MNZ|QZN|LPO|GBA)\d+\b", re.IGNORECASE)
VALIDATION_SUMMARY_KEYS = [
    "total_nodes",
    "total_edges",
    "total_accounts",
    "duplicate_towers",
    "duplicate_accounts",
    "missing_coordinates",
    "disconnected_nodes",
    "unmatched_accounts",
    "invalid_kml_features",
    "inferred_edges",
    "manual_overrides_applied",
]


def make_validation():
    return {
        "status": "ok",
        "errors": [],
        "warnings": [],
        "info": [],
        "summary": {key: 0 for key in VALIDATION_SUMMARY_KEYS},
    }


def finalize_validation(validation):
    if validation["errors"]:
        validation["status"] = "error"
    elif validation["warnings"]:
        validation["status"] = "warning"
    else:
        validation["status"] = "ok"
    return validation


def point_identity(point):
    return (
        (point.get("name") or "").strip().upper(),
        round(float(point["lat"]), 8),
        round(float(point["lon"]), 8),
    )


def normalize_node_name(value):
    text = str(value or "").strip().upper()
    if not text:
        return ""

    match = POLE_ID_PATTERN.search(text)
    if match:
        return match.group(0).upper()

    text = text.split()[0]
    text = re.sub(r"-\d+$", "", text)
    return text.strip()


def distance_sq(a, b):
    return (a["lat"] - b["lat"]) ** 2 + (a["lon"] - b["lon"]) ** 2


def _component_centroid(points, component):
    if not component:
        return None
    lat_sum = sum(points[idx]["lat"] for idx in component)
    lon_sum = sum(points[idx]["lon"] for idx in component)
    count = len(component)
    return {"lat": lat_sum / count, "lon": lon_sum / count}


def _find_fragment_root(points, component, adjacency, anchor_idx=None):
    if not component:
        return None

    endpoints = [idx for idx in component if len(adjacency.get(idx, ())) <= 1]
    candidates = endpoints or list(component)

    if anchor_idx is not None:
        return min(candidates, key=lambda idx: distance_sq(points[idx], points[anchor_idx]))

    centroid = _component_centroid(points, component)
    if centroid is None:
        return candidates[0]
    return min(candidates, key=lambda idx: distance_sq(points[idx], centroid))


def _build_fragment_spatial_pairs(points, component):
    if not component:
        return [], []

    if len(component) == 1:
        idx = component[0]
        return [], [points[idx].get("name", f"Tower {idx}")]

    root_idx = _find_fragment_root(points, component, {idx: set() for idx in component})
    if root_idx is None:
        return [], []

    remaining = [idx for idx in component if idx != root_idx]
    chain = [root_idx]

    while remaining:
        current = chain[-1]
        next_idx = min(remaining, key=lambda idx: distance_sq(points[current], points[idx]))
        chain.append(next_idx)
        remaining.remove(next_idx)

    pairs = [{
        "from": points[chain[pos]].get("name", f"Tower {chain[pos]}"),
        "to": points[chain[pos + 1]].get("name", f"Tower {chain[pos + 1]}"),
        "source": "distance_fallback",
    } for pos in range(len(chain) - 1)]
    return pairs, []


def _build_fragment_relationships(points, component, adjacency, anchor_idx=None):
    component = sorted(component)
    component_set = set(component)
    component_adjacency = {
        idx: sorted(neighbor for neighbor in adjacency.get(idx, ()) if neighbor in component_set)
        for idx in component
    }
    edge_count = sum(len(neighbors) for neighbors in component_adjacency.values()) // 2

    if edge_count == 0:
        return _build_fragment_spatial_pairs(points, component)

    root_idx = _find_fragment_root(points, component, component_adjacency, anchor_idx=anchor_idx)
    if root_idx is None:
        return _build_fragment_spatial_pairs(points, component)

    queue = deque([root_idx])
    visited = {root_idx}
    pairs = []

    while queue:
        current = queue.popleft()
        for neighbor in component_adjacency.get(current, ()):
            if neighbor in visited:
                continue
            visited.add(neighbor)
            queue.append(neighbor)
            pairs.append({
                "from": points[current].get("name", f"Tower {current}"),
                "to": points[neighbor].get("name", f"Tower {neighbor}"),
                "source": "fragment_edges",
            })

    standalone = [
        points[idx].get("name", f"Tower {idx}")
        for idx in component
        if not component_adjacency.get(idx)
    ]
    if not pairs and len(component) == 1:
        standalone = [points[root_idx].get("name", f"Tower {root_idx}")]

    unvisited = [idx for idx in component if idx not in visited]
    if unvisited:
        fallback_pairs, fallback_standalone = _build_fragment_spatial_pairs(points, unvisited)
        pairs.extend(fallback_pairs)
        standalone.extend(fallback_standalone)

    return pairs, standalone


def unique_tower_names(points):
    counts = {}
    updated = []

    for point in points:
        base_name = (point.get("name") or "").strip() or "Tower"
        key = base_name.upper()
        counts[key] = counts.get(key, 0) + 1

        name = base_name if counts[key] == 1 else f"{base_name}-{counts[key]}"

        item = dict(point)
        item["name"] = name
        updated.append(item)

    return updated


def build_inferred_edges(points, source_idx):
    n = len(points)
    in_tree = [False] * n
    best_parent = [-1] * n
    best_dist = [float("inf")] * n

    in_tree[source_idx] = True

    for idx in range(n):
        if idx == source_idx:
            continue
        best_parent[idx] = source_idx
        best_dist[idx] = distance_sq(points[source_idx], points[idx])

    edges = []
    for _ in range(n - 1):
        child = -1
        child_dist = float("inf")

        for idx in range(n):
            if in_tree[idx]:
                continue
            if best_dist[idx] < child_dist:
                child = idx
                child_dist = best_dist[idx]

        if child == -1:
            break

        parent = best_parent[child]
        if parent < 0:
            continue

        edges.append({
            "parent": parent,
            "child": child,
            "edge_type": "inferred",
            "confidence": "low",
            "distance": distance_sq(points[parent], points[child]),
            "fragment_id": None,
            "anchor_node": parent,
            "attachment_distance": distance_sq(points[parent], points[child]),
        })
        in_tree[child] = True

        for idx in range(n):
            if in_tree[idx]:
                continue

            candidate_dist = distance_sq(points[child], points[idx])
            if candidate_dist < best_dist[idx]:
                best_parent[idx] = child
                best_dist[idx] = candidate_dist

    return edges


def resolve_route_edges(points, route_edges):
    identity_to_index = {point_identity(point): idx for idx, point in enumerate(points)}
    resolved = []
    seen = set()
    invalid_edges = 0

    for start_key, end_key in route_edges or []:
        start_idx = identity_to_index.get(start_key)
        end_idx = identity_to_index.get(end_key)
        if start_idx is None or end_idx is None or start_idx == end_idx:
            invalid_edges += 1
            continue

        undirected_key = tuple(sorted((start_idx, end_idx)))
        if undirected_key in seen:
            continue
        seen.add(undirected_key)
        resolved.append((start_idx, end_idx))

    return resolved, invalid_edges


def get_connected_components(node_count, undirected_edges):
    adjacency = {idx: set() for idx in range(node_count)}
    for start_idx, end_idx in undirected_edges:
        adjacency[start_idx].add(end_idx)
        adjacency[end_idx].add(start_idx)

    visited = set()
    components = []
    for idx in range(node_count):
        if idx in visited:
            continue
        queue = deque([idx])
        component = []
        visited.add(idx)
        while queue:
            current = queue.popleft()
            component.append(current)
            for neighbor in adjacency[current]:
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                queue.append(neighbor)
        components.append(sorted(component))
    return components, adjacency


def build_directed_edges_from_routes(points, explicit_edges, source_idx):
    adjacency = {idx: set() for idx in range(len(points))}
    for start_idx, end_idx in explicit_edges:
        adjacency[start_idx].add(end_idx)
        adjacency[end_idx].add(start_idx)

    parent_by_child = {}
    visited = {source_idx}
    queue = deque([source_idx])

    while queue:
        current = queue.popleft()
        neighbors = sorted(
            adjacency.get(current, ()),
            key=lambda idx: (distance_sq(points[current], points[idx]), idx),
        )
        for neighbor in neighbors:
            if neighbor in visited:
                continue
            visited.add(neighbor)
            parent_by_child[neighbor] = current
            queue.append(neighbor)

    edges = [{
        "parent": parent,
        "child": child,
        "edge_type": "explicit",
        "confidence": "high",
        "distance": distance_sq(points[parent], points[child]),
        "fragment_id": None,
        "anchor_node": parent,
        "attachment_distance": None,
    } for child, parent in parent_by_child.items()]

    disconnected = sorted(set(range(len(points))) - visited)
    return edges, disconnected


def creates_cycle(parent_by_child, child_idx, candidate_parent_idx):
    current = candidate_parent_idx
    while current is not None:
        if current == child_idx:
            return True
        current = parent_by_child.get(current)
    return False


def apply_manual_overrides(edges, points, manual_overrides, validation):
    if not manual_overrides:
        return edges

    name_to_indexes = {}
    for idx, point in enumerate(points):
        key = normalize_node_name(point.get("name"))
        if key:
            name_to_indexes.setdefault(key, []).append(idx)

    parent_by_child = {edge["child"]: edge["parent"] for edge in edges}
    edge_by_child = {edge["child"]: edge for edge in edges}

    for child_name, parent_name in manual_overrides.items():
        child_key = normalize_node_name(child_name)
        parent_key = normalize_node_name(parent_name)

        child_indexes = name_to_indexes.get(child_key, [])
        parent_indexes = name_to_indexes.get(parent_key, [])
        if not child_indexes or not parent_indexes:
            validation["warnings"].append(
                f"Manual override skipped for {child_name} -> {parent_name}: tower not found."
            )
            continue

        child_idx = child_indexes[0]
        parent_idx = parent_indexes[0]
        if child_idx == parent_idx:
            validation["warnings"].append(
                f"Manual override skipped for {child_name}: parent cannot be the same tower."
            )
            continue

        trial_parent_map = dict(parent_by_child)
        trial_parent_map[child_idx] = parent_idx
        if creates_cycle(trial_parent_map, child_idx, parent_idx):
            validation["warnings"].append(
                f"Manual override skipped for {child_name} -> {parent_name}: would create a cycle."
            )
            continue

        parent_by_child[child_idx] = parent_idx
        edge_by_child[child_idx] = {
            "parent": parent_idx,
            "child": child_idx,
            "edge_type": "manual_override",
            "confidence": "medium",
            "distance": distance_sq(points[parent_idx], points[child_idx]),
            "fragment_id": None,
            "anchor_node": parent_idx,
            "attachment_distance": distance_sq(points[parent_idx], points[child_idx]),
        }
        validation["summary"]["manual_overrides_applied"] += 1

    return [edge_by_child[child] for child in sorted(edge_by_child)]


def describe_disconnected_fragments(points, source_idx, explicit_edges):
    components, adjacency = get_connected_components(len(points), explicit_edges)
    source_component = next((component for component in components if source_idx in component), [])
    fragments = []

    for fragment_id, component in enumerate(components, start=1):
        if source_idx in component:
            continue
        suggested_anchor = None
        suggested_distance = None
        if source_component:
            best_pair = min(
                (
                    (root_idx, fragment_idx, distance_sq(points[root_idx], points[fragment_idx]))
                    for root_idx in source_component
                    for fragment_idx in component
                ),
                key=lambda item: item[2],
            )
            suggested_anchor = best_pair[0]
            suggested_distance = best_pair[2]

        relationships, standalone_poles = _build_fragment_relationships(
            points,
            component,
            adjacency,
            anchor_idx=suggested_anchor,
        )

        fragments.append({
            "fragment_id": fragment_id,
            "nodes": component,
            "node_names": [points[idx].get("name", f"Tower {idx}") for idx in component],
            "relationships": relationships,
            "standalone_poles": standalone_poles,
            "structure_source": "fragment_edges" if any(pair.get("source") == "fragment_edges" for pair in relationships) else "distance_fallback",
            "attached": False,
            "attached_via": None,
            "anchor_node": suggested_anchor,
            "anchor_name": points[suggested_anchor].get("name", "") if suggested_anchor is not None else "",
            "attachment_distance": suggested_distance,
        })

    return fragments, source_component, adjacency


def summarize_final_connectivity(points, source_idx, edges):
    undirected_edges = [(edge["parent"], edge["child"]) for edge in edges]
    components, adjacency = get_connected_components(len(points), undirected_edges)
    source_component = next((component for component in components if source_idx in component), [])
    disconnected = [component for component in components if source_idx not in component]
    disconnected_nodes = [idx for component in disconnected for idx in component]
    return {
        "components": components,
        "source_component": source_component,
        "disconnected_components": disconnected,
        "disconnected_nodes": disconnected_nodes,
    }


def build_network(points, source_idx=0, route_edges=None, manual_overrides=None, source_explicit=False):
    if len(points) < 2:
        raise ValueError("Need at least 2 towers to build a network.")

    validation = make_validation()
    validation["summary"]["total_nodes"] = len(points)

    explicit_edges, invalid_route_edges = resolve_route_edges(points, route_edges)
    disconnected_fragments = []
    if invalid_route_edges:
        validation["warnings"].append(
            f"{invalid_route_edges} route connection(s) referenced towers that could not be resolved."
        )
    if explicit_edges:
        edges, disconnected = build_directed_edges_from_routes(points, explicit_edges, source_idx)
        disconnected_fragments, source_component, _ = describe_disconnected_fragments(points, source_idx, explicit_edges)
        if disconnected_fragments:
            disconnected_names = [name for fragment in disconnected_fragments for name in fragment["node_names"]]
            validation["summary"]["disconnected_nodes"] = len(disconnected_names)
            validation["warnings"].append(
                f"{len(disconnected_names)} tower(s) are disconnected from the explicit feeder path and were not auto-connected: " + ", ".join(disconnected_names[:20])
                + ("..." if len(disconnected_names) > 20 else "")
            )
            for fragment in disconnected_fragments[:20]:
                if fragment["anchor_name"]:
                    validation["info"].append(
                        f"Disconnected fragment {fragment['fragment_id']} ({', '.join(fragment['node_names'][:5])}"
                        + ("..." if len(fragment["node_names"]) > 5 else "")
                        + f") stays separate. Closest confirmed tower: {fragment['anchor_name']}."
                    )
        validation["info"].append("Connectivity used explicit route data.")
    else:
        edges = build_inferred_edges(points, source_idx)
        validation["warnings"].append("Connectivity inferred, may be inaccurate")
        validation["summary"]["inferred_edges"] = len(edges)

    if not source_explicit:
        validation["warnings"].append("Source tower was guessed because no explicit root was found.")

    edges = apply_manual_overrides(edges, points, manual_overrides or {}, validation)
    connectivity = summarize_final_connectivity(points, source_idx, edges)
    validation["summary"]["total_edges"] = len(edges)
    validation["summary"]["inferred_edges"] = sum(1 for edge in edges if edge.get("edge_type") == "inferred")
    validation["summary"]["disconnected_nodes"] = len(connectivity["disconnected_nodes"])

    source_point = points[source_idx]
    remaining = [point for idx, point in enumerate(points) if idx != source_idx]
    ordered_points = unique_tower_names([source_point] + remaining)

    old_to_new = {source_idx: 0}
    next_id = 1
    for idx in range(len(points)):
        if idx == source_idx:
            continue
        old_to_new[idx] = next_id
        next_id += 1

    towers = []
    for idx, point in enumerate(ordered_points):
        towers.append({
            "id": idx,
            "name": point["name"],
            "code": point.get("code", ""),
            "lat": point["lat"],
            "lon": point["lon"],
            "index": idx,
        })

    lines = []
    seen_pairs = set()
    for edge in edges:
        old_parent = edge["parent"]
        old_child = edge["child"]
        if old_parent not in old_to_new or old_child not in old_to_new:
            continue

        parent_idx = old_to_new[old_parent]
        child_idx = old_to_new[old_child]
        pair = (parent_idx, child_idx)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        parent = towers[parent_idx]
        child = towers[child_idx]
        lines.append({
            "id": len(lines),
            "name": f"{parent['name']} to {child['name']}",
            "start_index": parent_idx,
            "end_index": child_idx,
            "start_name": parent["name"],
            "end_name": child["name"],
            "coords": [[parent["lat"], parent["lon"]], [child["lat"], child["lon"]]],
            "is_inferred": edge.get("edge_type") == "inferred",
            "edge_source": edge.get("edge_type", "unknown"),
            "edge_type": edge.get("edge_type", "explicit"),
            "confidence": edge.get("confidence", "high"),
            "fragment_id": edge.get("fragment_id"),
            "anchor_node": old_to_new.get(edge.get("anchor_node")) if edge.get("anchor_node") is not None else None,
            "attachment_distance": edge.get("attachment_distance"),
        })

    center = [towers[0]["lat"], towers[0]["lon"]]

    return {
        "source": towers[0],
        "center": center,
        "towers": towers,
        "lines": lines,
        "is_inferred": validation["summary"]["inferred_edges"] > 0,
        "disconnected_fragments": disconnected_fragments,
        "validation": finalize_validation(validation),
    }
