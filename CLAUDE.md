# CLAUDE.md — Widget de chat white-label peste Dify

Citește întâi `docs/SPEC.md`: e sursa de adevăr pentru cerințe și etape (E1–E10).

## Ce construim

Un widget de chat inclus cu o linie `<script>` pe site-urile clienților (instituții publice și companii), plus un gateway care face legătura cu Dify Service API. Dify e doar backend-ul: interfața, brandingul și securitatea sunt ale noastre.

## Structura repository-ului

```
gateway/        Node.js 22 + TypeScript + Fastify — proxy spre Dify, configurație per client, securitate
widget/         TypeScript + Preact + Vite
  src/loader/   loader.js: buton, mesaj proactiv, notificări (Shadow DOM, în pagina gazdă)
  src/app/      aplicația de chat din iframe
config/tenants/ configurația per client (*.yaml) — fără secrete
deploy/         Dockerfile, docker-compose, etichete Traefik
e2e/            teste Playwright (+ axe-core)
docs/           SPEC.md și decizii de arhitectură (docs/adr/)
```

## Comenzi

```bash
pnpm install
pnpm dev                 # gateway + widget în mod dezvoltare (pagina demo: http://localhost:5173/demo.html)
pnpm test                # Vitest, toate pachetele
pnpm e2e                 # Playwright (pornește gateway-ul și widget-ul)
pnpm lint && pnpm typecheck
pnpm build               # gateway compilat + widget/dist (loader.js, app)
docker compose -f deploy/docker-compose.yml up --build
```

## Mediul de dezvoltare

- Dify de test: instanța „pilot”, prin tunel SSH: `DIFY_BASE_URL=http://localhost:8080/v1`.
- Cheia aplicației Dify în `gateway/.env` (`DIFY_API_KEY_PILOT=app-...`). `.env` e în `.gitignore`; există `.env.example` fără valori.
- Configurația clientului de test: `config/tenants/pilot.yaml`.

## Reguli care nu se încalcă

1. **Nicio cheie sau secret în codul widget-ului** sau în răspunsurile trimise browserului. Browserul cunoaște doar `tenant`. Cheile se citesc în gateway din variabile de mediu.
2. **Orice HTML provenit de la model se sanitizează** (DOMPurify) înainte de afișare. Fără `innerHTML` pe text nesanitizat. Link-urile primesc `rel="noopener noreferrer"` și `target="_blank"`.
3. **`postMessage` între loader și iframe:** se verifică întotdeauna `event.origin`, iar mesajele au un schema validat (Zod).
4. **Gateway-ul validează `Origin`** față de `allowedOrigins` al clientului și setează `Content-Security-Policy: frame-ancestors` per client.
5. **TypeScript strict** (`strict: true`, fără `any` nejustificat). Datele externe (Dify, configurație, cereri) se validează cu Zod la intrare.
6. **Accesibilitate WCAG 2.1 AA** pentru orice componentă nouă: tastatură, focus vizibil, `aria-live` pentru mesaje, etichete, contrast. Testul axe-core nu are voie să raporteze probleme „serious” sau „critical”.
7. **Fără date personale în loguri.** Logurile mesajelor trec prin funcția de mascare (CNP, telefon, email).
8. **Fără servicii externe în browser** (CDN-uri, fonturi, analytics, CAPTCHA de la terți). Totul se servește din gateway. Instituțiile publice cer ca datele să nu plece spre terți.
9. **Gateway-ul e stateless.** Starea (limitare trafic, sesiuni) stă în Redis, ca să poată rula în mai multe replici.
10. **Evenimentele Dify se normalizează în gateway** (`gateway/src/dify/events.ts`). Widget-ul consumă doar formatul intern, nu evenimentele Dify direct.

## Convenții

- Cod, nume de variabile și commit-uri în engleză; textele interfeței în română (și engleză), în `widget/src/app/i18n/`.
- Componentele Preact sunt mici, fiecare cu testul ei.
- Dimensiunea bundle-ului se verifică la build: `loader.js` < 15 KB gzip, aplicația < 120 KB gzip. Orice dependență nouă trebuie justificată.
- Deciziile de arhitectură se notează scurt în `docs/adr/NNN-titlu.md`.

## Mod de lucru

1. Lucrează **o etapă din SPEC odată** (E1, apoi E2…). La început, propune un plan și așteaptă confirmarea.
2. Pentru fiecare funcționalitate: scrie testul, implementează, rulează `pnpm test`, `pnpm lint`, `pnpm typecheck`; pentru interfață, rulează și `pnpm e2e`.
3. O etapă e gata doar când criteriile ei din SPEC sunt îndeplinite și toate testele trec. Spune explicit ce ai verificat și cum.
4. Un commit per funcționalitate, cu mesaj clar. Nu face push fără cerere.
5. Dacă un endpoint Dify nu se comportă ca în SPEC (în special la aplicațiile Agents Beta), verifică întâi cu `curl` pe instanța pilot, notează diferența în `docs/adr/` și adaptează normalizarea din gateway.
6. Nu adăuga funcționalități în afara etapei curente. Notează ideile în `docs/BACKLOG.md`.

## Ce să NU faci

- Nu folosi interfața web Dify sau scriptul ei de embed: tot scopul proiectului e să le înlocuim.
- Nu stoca istoricul conversațiilor în `localStorage` (date personale pe dispozitivul utilizatorului). Istoricul se cere de la gateway.
- Nu dezactiva verificările de securitate „temporar, pentru teste”: folosește configurația clientului de test.
