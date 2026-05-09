import re


TRANSFORMER_STYLE_PREFIXES = ("#DT",)
TRANSFORMER_NAME_PATTERNS = (
    re.compile(r"^\d+-DT.+$", re.IGNORECASE),
)
TRANSFORMER_TOKEN_SPLIT_PATTERN = re.compile(r"[^A-Z0-9_-]+")


def normalize_transformer_label(value):
    text = str(value or "").strip().upper()
    if not text:
        return ""
    return re.sub(r"^(?:UBDATA_)+", "", text)


def style_has_prefix(style_value, prefixes=TRANSFORMER_STYLE_PREFIXES):
    normalized = str(style_value or "").strip().upper()
    return any(normalized.startswith(str(prefix or "").upper()) for prefix in prefixes)


def text_contains_transformer_pattern(*texts):
    for text in texts:
        normalized = normalize_transformer_label(text)
        if not normalized:
            continue
        candidate_texts = [normalized]
        candidate_texts.extend(
            token
            for token in TRANSFORMER_TOKEN_SPLIT_PATTERN.split(normalized)
            if token
        )
        if any(
            pattern.search(candidate_text)
            for candidate_text in candidate_texts
            for pattern in TRANSFORMER_NAME_PATTERNS
        ):
            return True
    return False


def is_transformer_point_style(style_url="", resolved_style_url=""):
    return style_has_prefix(style_url) or style_has_prefix(resolved_style_url)


def is_transformer_point_candidate(feature_name="", feature_description="", extended_data_text="", style_url="", resolved_style_url=""):
    if not is_transformer_point_style(style_url, resolved_style_url):
        return False
    return text_contains_transformer_pattern(feature_name, feature_description, extended_data_text)
