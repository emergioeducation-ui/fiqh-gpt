# FiqhGPT — setup, keys and training guide

This is the complete operating manual for the app: what to configure, where each
key goes, how the answers are produced, and how to "train" it by adding kithabs.

---

## 1. What the app is made of

| Part | What it does |
| --- | --- |
| Chat screen (`/`) | Fatwa / Faraid / Zakat modes, school selector, temporary or saved chats |
| Auth screen (`/auth`) | Email + password sign-up with email verification, Google sign-in |
| Library (`/library`) | Public list of the reference books currently indexed |
| Admin (`/admin`) | Upload kithabs, index them, edit zakat rates, add administrators |
| Backend (Lovable Cloud) | Postgres + auth + row-level security + `pgvector` search |
| File storage (Cloudinary) | Keeps the original uploaded PDF/DOCX/TXT of every kithab |
| AI | Google Gemini (your key) for answers and for embeddings |

Nothing about the answers is hardcoded: every reply is generated from the
passages of the books you upload, plus the deterministic Faraid and Zakat
calculators.

---

## 2. The backend (database + auth)

The backend is already connected — it is Lovable Cloud, so there is nothing to
create by hand. It contains:

- `profiles` — one row per user, filled automatically on sign-up
- `user_roles` + `has_role()` — roles are stored in their own table (never on the
  profile), so admin rights cannot be escalated from the browser
- `admin_emails` — the list of addresses that become admin on sign-in
- `conversations`, `messages` — saved chats, readable only by their owner
- `books`, `book_passages` — the kithabs and their searchable passages
- `zakat_settings` — nisab and rate values used by the calculator
- `usage_events` — a light log of what was asked, for the admin screen

Row-level security is on for every table, so a signed-in user can only ever see
their own chats, and only admins can write to the library.

### Email verification

Email sign-up is enabled with verification on. A new user receives a
confirmation link and cannot sign in until they click it. Google sign-in is also
enabled and needs no confirmation step.

---

## 3. Keys — what to add and where

All keys live in the project's **secret store** (Project Settings → Secrets, or
just ask in chat and a secure form opens). They are only ever read by
server-side code — never shipped to the browser, never written into a file.

| Secret name | Where to get it | Used for |
| --- | --- | --- |
| `GEMINI_API_KEY` | Google AI Studio → **Get API key** (aistudio.google.com/apikey) | Generating answers and embedding passages |
| `GEMINI_CHAT_MODEL` | optional | Overrides the default `gemini-2.5-flash` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary dashboard → Product Environment | Archiving uploaded book files |
| `CLOUDINARY_API_KEY` | Cloudinary dashboard → API Keys | Signing uploads |
| `CLOUDINARY_API_SECRET` | Cloudinary dashboard → API Keys (reveal) | Signing uploads |

Notes:

- **Chrome / browser keys.** A Gemini key restricted to an HTTP referrer will
  not work here, because the calls are made from the server, not from Chrome.
  Create the key without an application restriction (or restrict it by IP), and
  under API restrictions allow the *Generative Language API*.
- **Cloudinary is optional.** Without it, books are still read, chunked and
  indexed — only the original file is not archived, and the admin screen says so.
- If `GEMINI_API_KEY` is absent the app falls back to the built-in Lovable AI
  gateway so you can test without your own key.

### Making yourself the administrator

1. Sign up on `/auth` with the email you want to be the admin, and confirm it.
2. Tell me the address (or add it to `admin_emails`) — the first address has to
   be granted once from the backend; after that you can add any further
   administrators yourself on **Admin → Administrators**.
3. Reload; the sidebar then shows **Admin & library**.

---

## 4. Which file format to use for the kithabs

Accepted: **PDF**, **DOCX**, **TXT** / **MD**, up to 25 MB per file.

Ranked by quality of the result:

1. **Plain text (`.txt`, UTF-8)** — best. No extraction loss, Arabic diacritics
   preserved, chapter headings kept exactly where you put them.
2. **DOCX** — very good; use real headings for chapters.
3. **Text-layer PDF** (typeset, selectable text) — good.
4. **Scanned PDF (images)** — *not usable*. There is no OCR in the app; run the
   scan through an Arabic OCR tool first (e.g. Tesseract with `ara`, or Google
   Document AI) and upload the resulting text.

Recommended text layout for the best citations:

```
# كتاب الطهارة
## باب المياه
[ص 12]
نص المسألة ...

## باب الوضوء
[ص 18]
نص المسألة ...
```

- Lines starting with `#` / `##` are treated as the chapter of the passages
  below them, and the chapter name is shown in the citation.
- `[ص 12]` or `[p. 12]` markers are picked up as the page label.
- Split very large works into one file per volume; each file becomes its own
  entry in the library.

Keep the Arabic as the original — do **not** translate before uploading. The
answers quote the Arabic and explain it in English.

---

## 5. Training the chatbot (adding kithabs)

"Training" here means building the reference index — the model itself is not
fine-tuned, which is what you want for fiqh, because every claim stays traceable
to a book.

1. Open **Admin & library → Add a kithab**.
2. Choose the file, give it a title (English and Arabic), the author, the
   **school** (Shafi'i, Hanafi, Maliki, Hanbali — or *General* for something
   school-neutral such as a Qur'an or hadith collection) and the **topic**
   (general, fatwa, faraid or zakat).
3. Press **Add kithab**. The text is extracted and cut into passages, and the
   original file goes to Cloudinary.
4. Go to the **Library** tab and press **Index now**. Each passage is embedded
   with Gemini; keep the page open while the progress bar runs. Large books can
   take several minutes — it is safe to press **Index now** again later to
   continue where it stopped.
5. Status `ready` means the book is live and can be quoted.

**Rebuild** clears a book's index (use it after changing the embedding model);
the trash icon deletes the book, its passages and its archived file.

### How much to upload

- One good matn plus its sharh per school already gives solid answers.
- For *General* fatwa mode, aim to have at least one book per school, otherwise
  the comparison will honestly report which schools it has no text for.
- Add a dedicated faraid book and a zakat book if you want detailed reasoning in
  those two modes; the arithmetic itself does not depend on them.

---

## 6. How an answer is produced

1. The question is normalised (Arabic alif/ya/hamza forms and diacritics are
   folded) and embedded.
2. Passages are retrieved with a hybrid search — vector similarity plus keyword
   matching — filtered by the selected school and topic.
3. In **General** fatwa mode the retrieval runs once per school, and the prompt
   asks for each school's position, where they agree, where they differ, and the
   stronger view with the reason.
4. In **Faraid** and **Zakat** the deterministic calculators run first (exact
   fractions, 'awl, radd, blocking rules; nisab, gold/silver, zakat al-fitr and
   kaffara), and their result is handed to the model as ground truth so the
   arithmetic can never drift.
5. The answer is written in English with the Arabic quotations kept in Arabic,
   followed by the list of sources (book, chapter, page) and a short note that
   this is study material, not a substitute for a qualified mufti.

If nothing relevant is found, the answer says so instead of inventing a ruling.

---

## 7. Zakat rates

**Admin → Zakat rates** holds the values the calculator uses: the gold and
silver nisab in grams, the current gold and silver price per gram, the 2.5 %
rate, and the zakat al-fitr amount per person. Update the metal prices
periodically — everything else follows from them.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "AI is not configured" | `GEMINI_API_KEY` missing — add it in Secrets |
| Answers say no reference was found | No indexed book matches that school/topic — upload one, or ask in General mode |
| Indexing stops with an error | Usually the Gemini quota; wait, then press **Index now** again |
| "No readable text was found" | Scanned PDF — OCR it first |
| Cloudinary warning on a book | Cloudinary keys missing or wrong; the book still works |
| Admin link missing | Your email is not in `admin_emails`, or you signed in before it was added — sign out and in again |
| Google sign-in error | The Google provider needs to be enabled for the backend |

---

## 9. Day-to-day checklist

- Add and index kithabs for every school you want covered.
- Refresh the gold/silver prices monthly.
- Read **Admin → Zakat rates → Recent questions** to see where the library is
  thin, and upload a book for that area.
