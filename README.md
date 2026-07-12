# ExplainIt — AI-Powered Course Content Simplification
### Built with Python Flask · IBM Watsonx.ai · Granite Models

---

## Project Structure

```
course-simplifier/
├── app.py                  ← Flask backend + AGENT_INSTRUCTIONS
├── requirements.txt        ← Python dependencies (includes PyMuPDF for PDF extraction)
├── .env.example            ← Environment variable template (copy → .env)
├── .env                    ← Your secrets (git-ignored)
├── templates/
│   └── index.html          ← Single-page frontend
└── static/
    ├── css/
    │   └── style.css       ← Custom styles (dark/light mode)
    └── js/
        └── main.js         ← Frontend logic
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.9 + |
| pip | latest |
| IBM Cloud account | [cloud.ibm.com](https://cloud.ibm.com) |
| Watsonx.ai project | [dataplatform.cloud.ibm.com](https://dataplatform.cloud.ibm.com) |
| PyMuPDF | auto-installed via requirements.txt |

---

## Quick Start

### 1. Clone / copy the project

```bash
cd course-simplifier
```

### 2. Create a virtual environment

```bash
# Windows (PowerShell)
python -m venv venv
.\venv\Scripts\Activate.ps1

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Open `.env` and fill in your IBM credentials:

```dotenv
IBM_API_KEY=your_ibm_cloud_api_key_here
WATSONX_PROJECT_ID=your_watsonx_project_id_here
WATSONX_URL=https://us-south.ml.cloud.ibm.com
FLASK_SECRET_KEY=a-long-random-string
FLASK_ENV=development
PORT=5000
```

#### Where to find your credentials:

| Variable | Location |
|----------|----------|
| `IBM_API_KEY` | IBM Cloud → Manage → IAM → [API keys](https://cloud.ibm.com/iam/apikeys) |
| `WATSONX_PROJECT_ID` | Watsonx.ai → your project → Manage tab → Project ID |
| `WATSONX_URL` | Use regional URL: `us-south.ml.cloud.ibm.com` or `eu-de.ml.cloud.ibm.com` |

### 5. Run the app

```bash
python app.py
```

Visit **http://localhost:5000** in your browser.

---

## File Upload

Users can upload a `.pdf` or `.txt` file directly in the UI (drag-and-drop or click-to-browse). The file is sent to `POST /api/upload`, the server extracts the text using **PyMuPDF** (PDF) or UTF-8/latin-1 decoding (TXT), and the extracted text is automatically populated into the content box — ready to simplify.

**Limits:** 10 MB maximum file size · `.pdf` and `.txt` supported · `.docx` support can be added by installing `python-docx` and uncommenting the handler in `app.py`.

---

## Editing the AI Agent Behaviour

Open [`app.py`](app.py) and find the `AGENT_INSTRUCTIONS` variable near the top of the file (around line 30). It is clearly marked with a comment banner:

```python
# ─────────────────────────────────────────────────────────────────────────────
# AGENT_INSTRUCTIONS
# ─────────────────────────────────────────────────────────────────────────────
AGENT_INSTRUCTIONS = """You are ExplainIt..."""
```

You can freely change:
- **Tone** — friendly, formal, Socratic, etc.
- **Output format** — add/remove sections (Core Idea, Takeaways, etc.)
- **Rules per level** — what Beginner vs Expert should receive
- **Constraints** — forbidden topics, maximum length, language requirements
- **Persona** — rename the bot, change its personality

The `{level}` placeholder is automatically replaced at runtime with the learner's chosen level (`BEGINNER` / `INTERMEDIATE` / `EXPERT`).

---

## Changing the AI Model

In [`app.py`](app.py), find:

```python
MODEL_ID = "ibm/granite-13b-instruct-v2"
```

Replace with any [Watsonx foundation model](https://dataplatform.cloud.ibm.com/docs/content/wsj/analyze-data/fm-models.html?context=wx) you have access to, e.g.:

| Model ID | Notes |
|----------|-------|
| `ibm/granite-13b-instruct-v2` | Default — balanced speed/quality |
| `ibm/granite-34b-code-instruct` | Best for code-heavy content |
| `ibm/granite-3-8b-instruct` | Faster, lower cost |
| `meta-llama/llama-3-1-70b-instruct` | High quality (if provisioned) |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serve the frontend |
| `POST` | `/api/upload` | Upload a `.pdf` or `.txt` file, returns extracted text |
| `POST` | `/api/simplify` | Simplify content / chat |
| `POST` | `/api/clear` | Clear session history |
| `GET` | `/api/health` | Health check & config status |

### `/api/simplify` Request body

```json
{
  "content": "Paste raw course text here",
  "level":   "beginner",
  "message": "Optional follow-up question"
}
```

---

## Production Deployment

### Option A — Gunicorn (Linux/macOS)

```bash
pip install gunicorn
gunicorn -w 2 -b 0.0.0.0:5000 app:app
```

### Option B — IBM Code Engine

1. Build a container image:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "app:app"]
```

2. Build and push:

```bash
docker build -t explainit .
docker tag explainit us.icr.io/<namespace>/explainit:latest
docker push us.icr.io/<namespace>/explainit:latest
```

3. Deploy on [IBM Code Engine](https://cloud.ibm.com/codeengine/overview) via the console or CLI.

### Option C — IBM Cloud Foundry

```bash
# manifest.yml
applications:
  - name: explainit
    memory: 256M
    buildpacks:
      - python_buildpack
    env:
      IBM_API_KEY: your-key
      WATSONX_PROJECT_ID: your-project-id
      WATSONX_URL: https://us-south.ml.cloud.ibm.com
      FLASK_SECRET_KEY: your-secret
```

```bash
ibmcloud cf push
```

---

## Security Notes

- **Never commit `.env`** — add it to `.gitignore`.
- Use **IBM Secrets Manager** or **Code Engine secrets** for production credentials.
- The `FLASK_SECRET_KEY` secures session cookies — use a cryptographically random 32+ character string in production.
- For public deployments, add rate-limiting (e.g., `flask-limiter`) to the `/api/simplify` endpoint.

---

## .gitignore Recommendations

```
.env
venv/
__pycache__/
*.pyc
*.pyo
.DS_Store
```

---

## License

MIT — free to use, modify, and deploy.

---

*Made with ❤️ using IBM Watsonx.ai and Granite — ExplainIt*
