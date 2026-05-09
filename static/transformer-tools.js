(function () {
    const TRANSFORMER_STYLE_PREFIXES = ["#DT"];
    const TRANSFORMER_NAME_PATTERNS = [/^\d+-DT.+$/i];
    const TRANSFORMER_TOKEN_SPLIT_PATTERN = /[^A-Z0-9_-]+/i;

    function normalizeTransformerLabel(value) {
        const text = String(value || "").trim().toUpperCase();
        if (!text) {
            return "";
        }
        return text.replace(/^(?:UBDATA_)+/i, "");
    }

    function styleHasPrefix(styleValue, prefixes = TRANSFORMER_STYLE_PREFIXES) {
        const normalized = String(styleValue || "").trim().toUpperCase();
        return prefixes.some((prefix) => normalized.startsWith(String(prefix || "").toUpperCase()));
    }

    function textContainsTransformerPattern(...texts) {
        return texts.some((text) => {
            const normalized = normalizeTransformerLabel(text);
            if (!normalized) {
                return false;
            }
            const candidateTexts = [normalized, ...normalized.split(TRANSFORMER_TOKEN_SPLIT_PATTERN).filter(Boolean)];
            return candidateTexts.some((candidateText) =>
                TRANSFORMER_NAME_PATTERNS.some((pattern) => pattern.test(candidateText))
            );
        });
    }

    function isTransformerPointStyle(styleUrl = "", resolvedStyleUrl = "") {
        return styleHasPrefix(styleUrl) || styleHasPrefix(resolvedStyleUrl);
    }

    function isTransformerFeature(feature) {
        if (!feature) {
            return false;
        }
        if (feature.is_transformer_candidate === true) {
            return true;
        }
        const geometry = String(feature.geometry || "").toLowerCase();
        const styleUrl = String(feature.style_url || "").trim().toUpperCase();
        const resolvedStyleUrl = String(feature.resolved_style_url || "").trim().toUpperCase();
        const nameText = String(feature.name || "").trim();
        const descriptionText = String(feature.description || "").trim();
        if (geometry === "point") {
            if (!isTransformerPointStyle(styleUrl, resolvedStyleUrl)) {
                return false;
            }
            return textContainsTransformerPattern(nameText, descriptionText);
        }
        return textContainsTransformerPattern(nameText, descriptionText);
    }

    window.TransformerTools = {
        TRANSFORMER_STYLE_PREFIXES,
        normalizeTransformerLabel,
        styleHasPrefix,
        textContainsTransformerPattern,
        isTransformerPointStyle,
        isTransformerFeature,
    };
})();
