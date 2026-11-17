# Specificație — Widget de chat propriu (white-label) peste Dify

Versiune 0.2 · 17.11.2026 · Document de pornire pentru dezvoltarea cu Claude Code

## 1. Scop

Un widget de chat propriu, inclus cu o singură linie de cod în orice pagină web, care înlocuiește interfața de chat a Dify. Dify rămâne motorul conversațional (modele, baze de cunoștințe, fluxuri) și e apelat exclusiv prin **Dify Service API**, printr-un **gateway propriu**.

Motivele:
- **White-label:** brandingul clientului, fără logo Dify (licența Dify interzice eliminarea logo-ului din interfețele lui, dar permite folosirea Dify ca backend prin API).
- **Securitate:** cheile API nu ajung niciodată în browser.
- **Conformitate:** accesibilitate WCAG 2.1 AA, GDPR, cerințele din matricea de cerințe a proiectului.
- **Reutilizare:** același produs pentru toți clienții, configurat per client.

## 2. Arhitectură

```
Site-ul clientului
  <script src="https://<gateway>/w/loader.js" data-tenant="<id>" async></script>
        │
        ├─ loader.js (în pagina gazdă, Shadow DOM)
        │    buton de pornire, mesaj proactiv, notificări, badge mesaje necitite
        │
        └─ <iframe src="https://<gateway>/w/app?tenant=<id>">   ← interfața de chat, izolată
                 │  fetch / SSE (același domeniu cu gateway-ul → fără CORS)
                 ▼
          Gateway (Node.js + TypeScript)
            - configurația per client (cheie Dify, URL Dify, domenii permise, temă)
            - limitare trafic, validare Origin, CSP frame-ancestors, anti-abuz
            - proxy SSE spre Dify, normalizarea evenimentelor
                 │
                 ▼
          Dify Service API (instanța clientului)  →  vLLM / TEI / reranker
```

Decizii:
- **iframe pentru interfață:** stilurile site-ului nu o afectează, iar site-ul nu poate citi conversația. Loader-ul din pagina gazdă e minimal și comunică cu iframe-ul prin `postMessage`, cu verificarea strictă a originii.
- **Gateway pe același domeniu cu iframe-ul:** fără CORS, cookie-uri first-party în iframe.
- **Fără chei în browser:** browserul cunoaște doar `tenant` (identificator public). Cheia Dify stă doar în gateway.

## 3. Identitatea utilizatorului

- **Anonim (implicit):** gateway-ul emite un identificator de vizitator semnat (cookie `HttpOnly`, `Secure`, `SameSite=None` în iframe), transmis spre Dify ca `user`. Istoricul conversațiilor e legat de acest identificator.
- **Autentificat prin portal (etapă ulterioară):** portalul transmite un token către widget; gateway-ul îl validează server-la-server și obține datele utilizatorului. Nu se transmit date personale prin URL.

## 4. Contractul cu Dify Service API

Endpoint-uri folosite (aplicație de tip chat; **de verificat în Dify → Access Point → API Reference** pentru tipul exact de aplicație, mai ales pentru Agents Beta):

| Funcție | Endpoint Dify |
|---|---|
| Trimitere mesaj (streaming) | `POST /v1/chat-messages` cu `response_mode: "streaming"` și `auto_generate_name: false` |
| Oprire generare | `POST /v1/chat-messages/{task_id}/stop` |
| Istoric mesaje | `GET /v1/messages?conversation_id=&user=` |
| Listă conversații | `GET /v1/conversations?user=` |
| Ștergere / redenumire conversație | `DELETE /v1/conversations/{id}`, `POST /v1/conversations/{id}/name` |
| Feedback | `POST /v1/messages/{id}/feedbacks` |
| Întrebări sugerate după răspuns | `GET /v1/messages/{id}/suggested` |
| Parametri aplicație (mesaj de întâmpinare, întrebări inițiale) | `GET /v1/parameters` |
| Încărcare fișier | `POST /v1/files/upload` |
| Voce → text / text → voce | `POST /v1/audio-to-text`, `POST /v1/text-to-audio` |

Gateway-ul normalizează evenimentele SSE Dify (`message`, `agent_message`, `agent_thought`, `message_end`, `error`, `ping` etc.) într-un format intern stabil, ca widget-ul să nu depindă de versiunea Dify. Citările vin în `message_end` → `metadata.retriever_resources`.

**Titlul conversației:** gateway-ul trimite întotdeauna `auto_generate_name: false`. Altfel, Dify face la prima întrebare din fiecare conversație un apel suplimentar la model pentru titlu (măsurat în pilot: 6,5–11 s pe același vLLM), care concurează cu răspunsurile pe GPU. Dacă lista de conversații are nevoie de un titlu, gateway-ul îl setează local (primele ~50 de caractere din prima întrebare) prin `POST /v1/conversations/{id}/name` cu `auto_generate: false` și `name`.

## 5. Cerințe funcționale, pe etape

Prioritatea: **E1–E3 = MVP demo**, **E4–E7 = produs**, **E8+ = depind de module externe** (operator uman, email, SSO portal).

### E1 — Gateway: chat cu streaming
- `POST /api/chat` → proxy SSE spre Dify, cu `conversation_id`, `user` și `auto_generate_name: false`.
- Configurație per client dintr-un fișier (YAML/JSON) montat în container: `difyBaseUrl`, `difyApiKey` (din variabilă de mediu), `allowedOrigins`, `theme`, `texts`.
- Erori Dify și timeout-uri traduse în mesaje clare pentru utilizator.

### E2 — Widget minimal
- Buton de pornire (launcher), fereastră de chat, deschidere / închidere / minimizare.
- Mesaj de întâmpinare automat la deschiderea ferestrei.
- Afișarea răspunsului în streaming, cu Markdown sanitizat (DOMPurify) și link-uri cu `rel="noopener noreferrer"`.
- Indicator „scrie…”, buton de oprire a generării, reîncercare la eroare.
- Interfață în limba română.

### E3 — Conversații și calitate
- Lista conversațiilor istorice; mai multe conversații active; închiderea conversației curente; reluarea unei conversații.
- Vizualizarea răspunsurilor primite cât timp utilizatorul nu era în pagină (istoric la redeschidere).
- Citări: sursa (documentul) sub fiecare răspuns.
- Feedback 👍/👎 pe mesaj; formular de feedback la închiderea conversației.
- Întrebări sugerate (inițiale și după răspuns).

### E4 — Personalizare per client (white-label)
Configurabile fără cod (fișier de configurare acum, interfață de administrare ulterior):
- icon-ul butonului de pornire, culorile, dimensiunea și poziția ferestrei, poziția butonului în pagină;
- logo, nume și avatar al asistentului; avatarul utilizatorului (sau fără avatar);
- textul din câmpul de scriere (placeholder), de exemplu „Scrieți întrebarea dumneavoastră…”;
- mesaj de întâmpinare; mesaj proactiv afișat deasupra butonului după un interval configurabil, fără deschiderea ferestrei;
- textele interfeței.

### E5 — Securitate și anti-abuz
- Validarea `Origin` / `Referer` față de `allowedOrigins`; `Content-Security-Policy: frame-ancestors` per client.
- Limitare trafic per IP și per vizitator; limită de lungime a mesajului; limită de conversații noi pe oră.
- Protecție anti-bot fără servicii externe (de exemplu ALTCHA, proof-of-work găzduit local), activată la depășirea pragurilor.
- Loguri fără date personale (mascare CNP, telefon, email).
- Antete de securitate, dependențe auditate (`pnpm audit`), imagine de container fără root.

### E6 — Accesibilitate, mobil, limbi
- WCAG 2.1 AA (obligatoriu pentru site-urile instituțiilor publice, conform Directivei UE 2016/2102): navigare completă de la tastatură, focus vizibil, `aria-live` pentru mesajele noi, contrast, `prefers-reduced-motion`, etichete pentru cititoare de ecran.
- Afișare pe tot ecranul pe mobil.
- Limba engleză pe lângă română (texte interfață; răspunsurile depind de Dify).

### E7 — Notificări
- Notificare vizuală și sonoră la mesaj nou, inclusiv cu fereastra minimizată (badge pe buton).
- Notă de informare GDPR la prima deschidere, cu link spre politica clientului.

### E8 — Voce
- Comutare între modul scris și modul vocal.
- Înregistrare din microfon (necesită HTTPS) → `audio-to-text` → mesaj; citirea răspunsului cu voce (`text-to-audio`).
- Serviciile de voce rulează local (STT/TTS pe serverul AI), prin Dify sau direct prin gateway.

### E9 — Fișiere și autentificare
- Atașarea de fișiere din fereastra de chat (tipuri și dimensiuni limitate per client).
- Autentificare automată pentru utilizatorii logați în portal (token transmis de site, validat server-la-server).
- Completare automată a întrebării în timpul scrierii, pe baza conținutului configurat.

### E10 — Operator uman și email (depinde de modulul de asistență)
- Transfer către operator uman doar după completarea și validarea adresei de email.
- Afișarea identității și avatarului operatorului; statusul conversației („un operator a preluat conversația”).
- Notificare pe email când utilizatorul primește un răspuns cât timp e deconectat; răspunsul pe email asociat conversației și vizibil în chat.

Widget-ul trebuie proiectat de la E1 astfel încât E10 să se poată adăuga: mesajele au un câmp `author` (asistent / operator / utilizator / sistem), iar conversațiile au un `status`.

## 6. Cerințe nefuncționale

| Cerință | Țintă |
|---|---|
| Dimensiune `loader.js` | < 15 KB gzip |
| Dimensiune aplicație iframe | < 120 KB gzip |
| Primul token afișat | depinde de model; widget-ul nu adaugă > 100 ms |
| Apeluri suplimentare la model | niciunul din partea widget-ului (fără generare automată de titlu) |
| Browsere | ultimele 2 versiuni Chrome, Edge, Firefox, Safari; Safari iOS, Chrome Android |
| Disponibilitate gateway | stateless, scalabil orizontal (replici), stare doar în Redis / Postgres |
| Observabilitate | loguri JSON, metrici Prometheus (`/metrics`), ID de corelare per cerere |

## 7. Stack tehnic

- **Gateway:** Node.js 22 LTS, TypeScript strict, Fastify, `undici` pentru proxy SSE, Redis (limitare trafic, sesiuni), Zod (validare), Pino (loguri), Vitest.
- **Widget:** TypeScript, Preact, Vite (build în mod bibliotecă: `loader.js` + aplicația iframe), CSS fără framework, DOMPurify, `marked`.
- **Teste:** Vitest (unitare), Playwright (end-to-end, inclusiv `@axe-core/playwright` pentru accesibilitate), k6 (încărcare prin gateway).
- **Livrare:** imagine Docker, rulată în stiva fiecărui client, publicată prin Traefik pe domeniul clientului (`/w/*` și `/api/*`).

## 8. Criterii de acceptanță pentru demo (E1–E3)

- [ ] Widget-ul se include pe o pagină HTML externă cu o singură linie `<script>`.
- [ ] Răspunsul apare în streaming; generarea se poate opri.
- [ ] Citările apar sub răspunsuri.
- [ ] Istoricul conversațiilor se păstrează la reîncărcarea paginii.
- [ ] Cheia Dify nu apare nicăieri în browser (verificat în DevTools → Network și Sources).
- [ ] Un domeniu care nu e în `allowedOrigins` nu poate încărca widget-ul.
- [ ] În Phoenix nu apar span-uri `generate_name` pentru conversațiile pornite din widget.
- [ ] Zero erori axe-core de nivel „serious” sau „critical”.
- [ ] Toate testele (unitare și end-to-end) trec în CI.

## 9. În afara scopului acestei specificații

- Interfața de administrare pentru configurare (etapă ulterioară; acum: fișier de configurare).
- Modulul de operator uman (live chat), canalele email / SMS / telefonie.
- Rapoartele și analizele (rămân în Dify și în monitorizare).
