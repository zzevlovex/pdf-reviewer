# ReviewerStudio

Drop handout PDFs and get a colorful exam reviewer PDF: a concept summary with highlighted keywords, a key terms table, and scenario questions with an answer key.

Everything runs in the browser. The AI is free: Google Gemini reads the PDFs, and if its daily free limit runs out the app switches to Groq automatically.

**Setup (once per device):** open the site, tap **AI keys**, and paste a free key from https://aistudio.google.com/apikey (Gemini) and https://console.groq.com/keys (Groq). Keys are saved only in that browser.

**Develop:** `npm install`, then `npm run dev` (http://localhost:5173). Tests: `npm test`. Build: `npm run build`.

**Deploy:** every push to `main` publishes the site to GitHub Pages through `.github/workflows/deploy.yml`.
