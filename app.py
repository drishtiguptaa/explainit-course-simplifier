"""
╔══════════════════════════════════════════════════════════════════════════════╗
║        AI-Powered Course Content Simplification — Flask Backend             ║
║        IBM Watsonx.ai  ×  Llama 3 / Granite Models                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import io
import os
import re
import json
import logging
from datetime import datetime, timezone
from flask import Flask, render_template, request, jsonify, session
from flask_cors import CORS
from dotenv import load_dotenv
import fitz  # PyMuPDF — PDF text extraction
from ibm_watsonx_ai.foundation_models import ModelInference
from ibm_watsonx_ai.metanames import GenTextParamsMetaNames as GenParams

# ─────────────────────────────────────────────────────────────────────────────
# AGENT_INSTRUCTIONS
# ─────────────────────────────────────────────────────────────────────────────
# Edit this section to control the AI agent's behavior, tone, and rules.
# These instructions are injected into every simplification request.
#
# Available placeholders (auto-replaced at runtime):
#   {level}  — learner proficiency level: BEGINNER / INTERMEDIATE / EXPERT
#
# Tips:
#   • Keep instructions concise but specific for best results.
#   • You can tell the model to use bullet points, analogies, emojis, etc.
#   • Add forbidden topics, length limits, or language constraints here.
#   • This prompt is ONLY used when the user submits content to simplify.
#     Conversational greetings/questions are handled by CHAT_INSTRUCTIONS below.
# ─────────────────────────────────────────────────────────────────────────────
AGENT_INSTRUCTIONS = """You are ExplainIt, a friendly and expert educational content simplifier powered by IBM Watsonx.ai.

Your mission is to transform complex course material into clear, engaging explanations tailored precisely to the learner's proficiency level.

LEARNER LEVEL: {level}

RULES:
1. BEGINNER      → Use everyday language, real-world analogies, avoid jargon. Keep sentences short. Add encouraging phrases.
2. INTERMEDIATE  → Assume some domain knowledge. Use proper terminology with brief definitions. Balance depth with clarity.
3. EXPERT        → Be concise and technical. Skip basic explanations. Highlight nuances, edge-cases, and deeper implications.

AMBIGUITY: If the source content is incomplete, ambiguous, or too short to meaningfully simplify, begin your response with the marker ⚠️ AMBIGUITY_WARNING: followed by a one-sentence explanation of what is missing or unclear, then continue with your best attempt at simplification.

OUTPUT FORMAT — always follow this exact structure:
🎯 Core Idea: <one-line summary>

📖 Explanation:
<well-structured paragraphs>

💡 Key Takeaways:
- <point 1>
- <point 2>
- <point 3>
(3–5 bullet points)

🔗 Real-World Example: <concrete example anchoring the concept> (include only when relevant)

📝 Note: Always verify this simplified content against your official syllabus or textbook before exams.

TONE: Supportive, clear, never condescending.
CONSTRAINTS: Do not hallucinate facts. Do not add content not present in the source material.
"""
# ─────────────────────────────────────────────────────────────────────────────
# END OF AGENT_INSTRUCTIONS
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# CHAT_INSTRUCTIONS
# ─────────────────────────────────────────────────────────────────────────────
# Used ONLY for conversational messages that contain no course content.
# Keep this brief — it should produce short, natural replies.
# ─────────────────────────────────────────────────────────────────────────────
CHAT_INSTRUCTIONS = """You are ExplainIt, an AI assistant that simplifies educational content.

Respond naturally and conversationally. Keep replies short (2–4 sentences max).

If the user greets you or asks what you do: introduce yourself briefly and invite them to paste or upload course material so you can simplify it for them.
If the user asks a general question not related to course content: answer helpfully and briefly, then gently steer back to your purpose.
Do NOT use the structured format (Core Idea / Explanation / Key Takeaways) for conversational replies — that format is only for simplifying actual course content.
"""
# ─────────────────────────────────────────────────────────────────────────────
# END OF CHAT_INSTRUCTIONS
# ─────────────────────────────────────────────────────────────────────────────


# ── Bootstrap ─────────────────────────────────────────────────────────────────
load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-change-in-production")
CORS(app)

# ── Watsonx.ai configuration ──────────────────────────────────────────────────
IBM_API_KEY     = os.getenv("IBM_API_KEY", "")
WATSONX_URL     = os.getenv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com")
WATSONX_PROJECT = os.getenv("WATSONX_PROJECT_ID", "")

# Model — change to any supported model ID in your environment.
# Options confirmed available:
#   meta-llama/llama-3-3-70b-instruct  ← best quality for simplification (default)
#   meta-llama/llama-3-1-70b-gptq      ← quantised 70B, slightly faster
#   meta-llama/llama-3-1-8b            ← fastest, lightest
#   ibm/granite-8b-code-instruct       ← best for code-heavy content
MODEL_ID = "meta-llama/llama-3-3-70b-instruct"

# Generation parameters — tune as needed
GEN_PARAMS = {
    GenParams.MAX_NEW_TOKENS: 1024,
    GenParams.MIN_NEW_TOKENS: 10,
    GenParams.TEMPERATURE: 0.7,
    GenParams.TOP_P: 0.9,
    GenParams.TOP_K: 50,
    GenParams.REPETITION_PENALTY: 1.1,
}

# ── In-memory analytics counters (resets on server restart) ───────────────────
# Structure: { "beginner": N, "intermediate": N, "expert": N, "total": N }
ANALYTICS: dict[str, int] = {"beginner": 0, "intermediate": 0, "expert": 0, "total": 0}

# ── In-memory feedback store (resets on server restart) ───────────────────────
# Each entry: { "ts": ISO-string, "level": str, "vote": "up"|"down" }
FEEDBACK: list[dict] = []

# ── Special tokens to strip from model output (Granite + Llama artefacts) ────
_ARTIFACT_RE = re.compile(
    r"<\|(?:end|eot_id|start_header_id|end_header_id|begin_of_text|/s)\|>"
    r"|<\|(?:system|user|assistant)\|>"
    r"|\[INST\]|\[/INST\]|\[SYS\]|\[/SYS\]",
    re.IGNORECASE,
)

# ── Ambiguity marker written by the model ─────────────────────────────────────
_AMBIGUITY_RE = re.compile(r"⚠️\s*AMBIGUITY_WARNING:\s*(.+?)(?:\n|$)", re.DOTALL)

# ── Short-message heuristic for conversational detection ─────────────────────
_GREETING_RE = re.compile(
    r"^\s*(hi+|hey+|hello+|howdy|what'?s up|good\s*(morning|afternoon|evening)|"
    r"who are you|what (are|can) you do|help|thanks?|thank you|ok|okay|"
    r"great|cool|nice|got it|sure|alright|bye|goodbye)\W*$",
    re.IGNORECASE,
)

# ── File upload limits ────────────────────────────────────────────────────────
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB
MAX_WORDS        = 6_000             # word ceiling before truncation


# ── Helper functions ──────────────────────────────────────────────────────────

def is_conversational(raw_content: str, message: str) -> bool:
    """Return True when the request is a greeting / short chat with no course content."""
    if raw_content:
        return False
    msg = message.strip()
    if not msg:
        return False
    if len(msg) < 30:
        return True
    if len(msg) < 120 and _GREETING_RE.match(msg):
        return True
    return False


def clean_response(text: str) -> str:
    """Strip residual special tokens and normalise whitespace."""
    text = _ARTIFACT_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_ambiguity(text: str) -> tuple[str, str | None]:
    """
    If the response starts with ⚠️ AMBIGUITY_WARNING: …
    return (cleaned_body, warning_text).
    Otherwise return (text, None).
    """
    m = _AMBIGUITY_RE.search(text)
    if m:
        warning = m.group(1).strip()
        body    = _AMBIGUITY_RE.sub("", text).strip()
        return body, warning
    return text, None


def get_watsonx_model() -> ModelInference:
    """Initialise and return a Watsonx ModelInference client using IBM Cloud IAM."""
    logger.info("Connecting to Watsonx.ai | url=%s | model=%s", WATSONX_URL, MODEL_ID)
    return ModelInference(
        model_id=MODEL_ID,
        credentials={"url": WATSONX_URL, "apikey": IBM_API_KEY},
        project_id=WATSONX_PROJECT,
        params=GEN_PARAMS,
    )


def build_prompt(system_instructions: str, user_content: str, chat_history: list) -> str:
    """Build a prompt using the Llama 3 chat template."""
    parts = [
        "<|begin_of_text|>",
        f"<|start_header_id|>system<|end_header_id|>\n\n{system_instructions}<|eot_id|>",
    ]
    for turn in chat_history[-6:]:
        role    = turn.get("role", "user")
        content = turn.get("content", "")
        parts.append(f"<|start_header_id|>{role}<|end_header_id|>\n\n{content}<|eot_id|>")
    parts.append(f"<|start_header_id|>user<|end_header_id|>\n\n{user_content}<|eot_id|>")
    parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
    return "\n".join(parts)


def truncate_to_word_limit(text: str, limit: int = MAX_WORDS) -> tuple[str, bool]:
    """Chop text at word boundary `limit`. Returns (text, was_truncated)."""
    words = text.split()
    if len(words) <= limit:
        return text, False
    return " ".join(words[:limit]), True


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract plain text from a PDF using PyMuPDF."""
    parts = []
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        for page in doc:
            parts.append(page.get_text())
    return "\n".join(parts).strip()


def extract_text_from_txt(file_bytes: bytes) -> str:
    """Decode plain text, UTF-8 with latin-1 fallback."""
    try:
        return file_bytes.decode("utf-8").strip()
    except UnicodeDecodeError:
        return file_bytes.decode("latin-1").strip()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    session.setdefault("chat_history", [])
    session.setdefault("content_history", [])   # last 3 simplified contents
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload_file():
    """
    POST /api/upload  (multipart/form-data)
    Returns: { text, filename, size, words, truncated, warning }
    """
    if "file" not in request.files:
        return jsonify({"error": "No file part in request."}), 400
    f = request.files["file"]
    if not f or f.filename == "":
        return jsonify({"error": "No file selected."}), 400

    filename   = f.filename.lower()
    file_bytes = f.read()

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        return jsonify({"error": f"File is too large. Maximum size is {mb} MB."}), 413

    if filename.endswith(".pdf"):
        try:
            text = extract_text_from_pdf(file_bytes)
        except Exception as exc:
            logger.error("PDF extraction failed: %s", exc)
            return jsonify({"error": f"Could not read PDF: {exc}"}), 422
    elif filename.endswith(".txt"):
        text = extract_text_from_txt(file_bytes)
    elif filename.endswith(".docx"):
        return jsonify({"error": "DOCX requires python-docx. Save as .txt or .pdf."}), 415
    else:
        return jsonify({"error": "Unsupported file type. Upload .pdf or .txt."}), 415

    if not text:
        return jsonify({"error": "File is empty or has no extractable text."}), 422

    text, was_truncated = truncate_to_word_limit(text)
    warning = (
        f"Your file contained more than {MAX_WORDS:,} words. "
        f"Only the first {MAX_WORDS:,} words were loaded to stay within the "
        f"model's context limit. Consider splitting the file into smaller sections."
    ) if was_truncated else None

    word_count = len(text.split())
    logger.info("File uploaded | name=%s | chars=%d | words=%d | truncated=%s",
                f.filename, len(text), word_count, was_truncated)
    return jsonify({
        "text": text, "filename": f.filename, "size": len(text),
        "words": word_count, "truncated": was_truncated, "warning": warning,
    })


@app.route("/api/simplify", methods=["POST"])
def simplify():
    """
    POST /api/simplify
    Body: { content, level, message }
    Returns: { response, ambiguity_warning, is_conversational, history }
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON body received."}), 400

    raw_content = (data.get("content") or "").strip()
    level       = (data.get("level")   or "beginner").strip().capitalize()
    message     = (data.get("message") or "").strip()

    if not raw_content and not message:
        return jsonify({"error": "Please provide course content or a message."}), 400

    session.setdefault("chat_history",    [])
    session.setdefault("content_history", [])
    chat_history:    list = session["chat_history"]
    content_history: list = session["content_history"]

    is_conv = is_conversational(raw_content, message)

    if is_conv:
        system_instructions = CHAT_INSTRUCTIONS
        user_prompt         = message
        logger.info("Conversational | msg=%r", message[:60])
    else:
        system_instructions = AGENT_INSTRUCTIONS.replace("{level}", level.upper())
        if raw_content:
            user_prompt = (
                f"Please simplify the following course content for a {level} learner:\n\n"
                f"---\n{raw_content}\n---"
            )
            if message:
                user_prompt += f"\n\nAdditional instruction from learner: {message}"
            # ── session content history (last 3 pieces) ───────────────────────
            content_history.append({"level": level, "snippet": raw_content[:300]})
            session["content_history"] = content_history[-3:]
        else:
            # Follow-up chat — enrich with most-recent content snippet for context
            if content_history:
                ctx = content_history[-1]["snippet"]
                user_prompt = (
                    f"[Context from earlier content: {ctx[:200]}…]\n\n{message}"
                )
            else:
                user_prompt = message
        # ── analytics ─────────────────────────────────────────────────────────
        lvl_key = level.lower()
        ANALYTICS[lvl_key] = ANALYTICS.get(lvl_key, 0) + 1
        ANALYTICS["total"] = ANALYTICS.get("total", 0) + 1
        logger.info("Simplify | level=%s | content_len=%d | analytics=%s",
                    level, len(raw_content), ANALYTICS)

    full_prompt = build_prompt(system_instructions, user_prompt, chat_history)

    try:
        model  = get_watsonx_model()
        result = model.generate_text(prompt=full_prompt)
        cleaned = clean_response(result if isinstance(result, str) else str(result))

        # Extract ambiguity warning if present
        body, ambiguity_warning = extract_ambiguity(cleaned)

        chat_history.append({"role": "user",     "content": user_prompt})
        chat_history.append({"role": "assistant", "content": body})
        session["chat_history"] = chat_history[-20:]
        session.modified = True

        return jsonify({
            "response":          body,
            "ambiguity_warning": ambiguity_warning,
            "is_conversational": is_conv,
            "history":           session["chat_history"],
        })

    except Exception as exc:
        logger.error("Watsonx API error: %s", exc, exc_info=True)
        return jsonify({"error": f"Watsonx API error: {str(exc)}"}), 500


@app.route("/api/feedback", methods=["POST"])
def feedback():
    """
    POST /api/feedback
    Body: { vote: "up"|"down", level: str, response_preview: str }
    Stores feedback in-memory and appends to feedback_log.json.
    """
    data = request.get_json(force=True) or {}
    vote    = data.get("vote", "")
    level   = (data.get("level") or "unknown").strip().lower()
    preview = (data.get("response_preview") or "")[:120]

    if vote not in ("up", "down"):
        return jsonify({"error": "vote must be 'up' or 'down'"}), 400

    entry = {
        "ts":      datetime.now(timezone.utc).isoformat(),
        "vote":    vote,
        "level":   level,
        "preview": preview,
    }
    FEEDBACK.append(entry)

    # Persist to a local JSON log file (append-friendly, one entry per line)
    log_path = os.path.join(os.path.dirname(__file__), "feedback_log.jsonl")
    try:
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")
    except Exception as exc:
        logger.warning("Could not write feedback log: %s", exc)

    logger.info("Feedback | vote=%s | level=%s", vote, level)
    return jsonify({"status": "ok", "total_feedback": len(FEEDBACK)})


@app.route("/api/analytics", methods=["GET"])
def analytics():
    """GET /api/analytics — returns simplification counts per level."""
    up_votes   = sum(1 for f in FEEDBACK if f["vote"] == "up")
    down_votes = sum(1 for f in FEEDBACK if f["vote"] == "down")
    return jsonify({
        "simplifications": ANALYTICS,
        "feedback": {
            "up":    up_votes,
            "down":  down_votes,
            "total": len(FEEDBACK),
        },
    })


@app.route("/api/clear", methods=["POST"])
def clear_history():
    session["chat_history"]    = []
    session["content_history"] = []
    session.modified = True
    return jsonify({"status": "cleared"})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status":             "ok",
        "model":              MODEL_ID,
        "region":             WATSONX_URL,
        "project_configured": bool(WATSONX_PROJECT),
        "api_key_configured": bool(IBM_API_KEY),
    })


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    logger.info("Starting ExplainIt on port %d (debug=%s)", port, debug)
    app.run(host="0.0.0.0", port=port, debug=debug)
