# Specificație E4b — Interfață de administrare a widget-ului

Versiune 0.3 · 18.11.2026 · Completare la `widget-SPEC.md` (v0.2). Se implementează **imediat după E4**, înaintea E5–E10, în două tranșe (vezi §11).

## 1. Scop

O interfață web prin care administratorii fiecărui client își personalizează singuri widget-ul de chat, fără să editeze fișiere și fără intervenția echipei tehnice.

Acoperă cerința din matricea de cerințe: *„interfața de chat web va putea fi personalizată prin intermediul unei interfețe de administrare”*, pentru icon-ul de pornire, culori, dimensiunea și poziția ferestrei, poziția butonului de pornire și mesajul proactiv trimis după un interval configurabil.

**Nu acoperă** conținutul asistentului (baze de cunoștințe, prompturi, fluxuri, istoricul conversațiilor). Acestea rămân în consola Dify a clientului.

## 2. Premise din etapele anterioare

E4b presupune că E4 a livrat:
- o **schemă Zod versionată** a configurației per client, sursa unică de adevăr pentru validare;
- **reîncărcarea configurației fără repornirea gateway-ului**;
- **fără secrete în configurație** (cheia Dify rămâne doar în `.env` / secretele containerului).

Interfața de administrare nu introduce un al doilea format de configurare. Citește și scrie exact obiectul definit de schema din E4.

## 3. Arhitectură

```
Browser administrator
   │  https://<gateway>/admin           (aplicație separată de widget)
   ▼
Gateway
   ├─ /admin/*         → aplicația de administrare (fișiere statice)
   ├─ /admin/api/*     → API de administrare (autentificat, pe rol)
   ├─ /admin/preview   → widget-ul randat cu configurația-ciornă
   └─ /api/*, /w/*     → widget-ul public (neschimbat)
   │
   ├─ Keycloak (OIDC)  → autentificare și roluri
   └─ Postgres         → configurații: ciorne, versiuni publicate, istoric, jurnal de audit
```

Decizii:
- **Aplicație separată** de widget (bundle propriu, aceeași stivă Preact + Vite). Bugetul de dimensiune al widget-ului public nu e afectat.
- **Stocare în Postgres**, cu versiuni. La publicare, gateway-ul reîncarcă configurația clientului (mecanismul din E4). Fișierul de configurare din E4 rămâne valabil ca sursă inițială (seed) și ca export.
- **Același domeniu cu gateway-ul**, dar căi, cookie-uri și politici CSP separate de widget-ul public.

## 4. Autentificare și roluri

### 4.1 Principiu
- **OIDC cu Keycloak** (Authorization Code + PKCE). Keycloak e **intermediar (identity broker)** între interfața de administrare și sistemul de identitate al clientului: administratorul se loghează cu contul lui de la serviciu, iar noi nu gestionăm parole.
- **Un realm per client**, într-un singur Keycloak. Fiecare realm are conexiunea la SSO-ul clientului, rolurile și politicile lui (MFA, durata sesiunii). Același realm protejează și consola Dify a clientului (prin oauth2-proxy), deci utilizatorul are o singură logare pentru ambele.
- **Clientul se deduce din realm-ul care a emis token-ul** (claim-ul `iss`), nu dintr-un parametru sau din URL. Gateway-ul are o mapare fixă `issuer → tenant`, în configurația de server (nu în configurația editabilă a clientului).
- **Fără conturi locale** în gateway.
- Pentru dezvoltare și teste: Keycloak în `docker-compose` cu un realm de test per client demonstrativ.

### 4.2 Conectarea la sistemul de identitate al clientului

| Ce are clientul | Configurare în realm-ul lui | Observații |
|---|---|---|
| Entra ID (Azure AD), ADFS, Keycloak propriu, Okta sau alt IdP OIDC/SAML | **Identity Brokering** (OIDC sau SAML) | Varianta preferată: nu cere acces la rețeaua clientului, doar schimb de metadate (redirect URI, client ID, certificat). |
| Active Directory sau LDAP on-prem, fără IdP federat | **User Federation (LDAP)**, doar citire, LDAPS pe 636 | Cere conexiune de rețea (VPN site-to-site sau IPsec) și aprobări de securitate. Parolele se verifică în AD, nu se copiază. |
| Niciun sistem | Conturi locale în realm, **MFA obligatoriu** (TOTP) | Administratorul clientului poate primi rolul de a-și gestiona singur utilizatorii realm-ului. |

### 4.3 Roluri și mapare

| Rol | Ce poate face |
|---|---|
| `widget-editor` (per client) | editează ciorna, folosește previzualizarea |
| `widget-admin` (per client) | tot ce face editorul + publică, revine la o versiune anterioară, gestionează imaginile |
| `super-admin` (Smartbytesoft, realm separat) | toți clienții; creează clienți; vede jurnalul de audit global |

- Rolurile per client vin din **grupurile clientului** (de exemplu „Chatbot-Administratori” → `widget-admin`, „Chatbot-Editori” → `widget-editor`), prin mapper-e în Keycloak: claim de grup OIDC, atribut SAML sau grup LDAP.
- Contul se creează automat la prima logare (just-in-time). Accesul se dă și se retrage din directorul clientului, fără intervenția noastră.
- Rolurile se verifică pe server la fiecare cerere. Sesiunea de administrare are durată limitată (implicit 8 ore, configurabil per realm), ca un utilizator scos din grup să piardă accesul la următoarea logare.

### 4.4 De aflat de la fiecare client (analiza tehnică)
1. Ce sistem de identitate folosiți (AD on-prem, Entra ID, ADFS, altul)?
2. Acceptați OIDC sau SAML către o aplicație externă, sau doar LDAP?
3. Ce grupuri vor avea acces la administrarea asistentului și cu ce rol?
4. Se cere MFA? Există politici de durată a sesiunii?

## 5. Cerințe funcționale

### 5.1 Editarea configurației
Formularul e grupat pe secțiuni și generat sau validat din schema Zod din E4:
- **Buton de pornire:** icon (imagine încărcată sau din setul implicit), culoare, poziție (jos dreapta / jos stânga), distanțe față de margini.
- **Fereastră:** culori (antet, mesaje asistent, mesaje utilizator, butoane), lățime, înălțime, poziție.
- **Identitate:** logo, numele asistentului, avatarul asistentului, avatarul utilizatorului (sau fără avatar).
- **Texte:** mesaj de întâmpinare, placeholder pentru câmpul de scriere, textele interfeței (RO și EN).
- **Mesaj proactiv:** activ/inactiv, text, întârzierea în secunde, frecvența (o dată pe sesiune / o dată pe zi).
- **Citări:** maparea nume fișier → titlu afișat, afișarea fragmentului (da/nu).
- **Comportament:** întrebări sugerate după răspuns (da/nu), durata cookie-ului de vizitator, link spre politica de confidențialitate.
- **Domenii permise** (`allowedOrigins`): doar `widget-admin` și `super-admin`, cu avertizare la modificare.

Validare în timp real, cu mesajele de eroare lângă câmp.

**Verificare automată de contrast:** pentru combinațiile text/fundal, formularul calculează raportul de contrast. Sub 4,5:1 (WCAG AA) afișează o eroare și **nu permite publicarea**.

### 5.2 Previzualizare
- Previzualizare live a widget-ului cu configurația-ciornă, într-un iframe, pe o pagină demo neutră.
- Comutare desktop / mobil.
- Previzualizarea nu modifică widget-ul public. Folosește un token de previzualizare cu durată scurtă, legat de sesiunea administratorului.
- Previzualizarea poate trimite mesaje reale către Dify-ul clientului, marcate în gateway ca `preview` (excluse din statistici).

### 5.3 Ciornă, publicare, istoric
- Modificările se salvează automat ca **ciornă**. Widget-ul public nu le vede.
- **Publicarea** creează o versiune nouă, imutabilă, și reîncarcă configurația în gateway. Widget-ul public o folosește de la următoarea încărcare a paginii.
- **Istoric:** lista versiunilor (cine, când, comentariu opțional), diferențele față de versiunea anterioară, **revenire** la o versiune (creează o versiune nouă identică cu cea aleasă).
- **Export / import JSON** al configurației, validat cu aceeași schemă.

### 5.4 Imagini (logo, icon, avatare)
- Formate acceptate: PNG, WebP, JPEG. **Fără SVG** (risc de script în imagine). Dimensiune maximă configurabilă (implicit 512 KB).
- La încărcare: verificarea tipului real (magic bytes, nu extensia), redimensionare și eliminarea metadatelor (EXIF).
- Imaginile se servesc de gateway, de pe același domeniu (regula „nicio resursă externă în browser”), cu nume bazate pe hash și cache lung.

### 5.5 Jurnal de audit
- Fiecare salvare, publicare, revenire, încărcare de imagine și modificare a domeniilor permise se înregistrează: utilizator, client, acțiune, dată, diferențe.
- Jurnalul nu poate fi modificat din interfață. Păstrare configurabilă (implicit 12 luni).

### 5.6 Administrarea clienților (doar `super-admin`)
- Creare client: identificator, nume, URL Dify, numele secretului care conține cheia Dify (nu cheia însăși), domenii permise inițiale.
- Dezactivare client (widget-ul răspunde cu mesajul de indisponibilitate).

## 6. Securitate

- Cookie de sesiune separat pentru `/admin` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/admin`).
- Protecție CSRF pentru toate cererile care modifică date.
- CSP strictă pentru `/admin` (`default-src 'self'`, `frame-ancestors 'none'`, cu excepția iframe-ului de previzualizare pe același domeniu).
- Limitare trafic pe autentificare și pe API-ul de administrare.
- Cheile Dify **nu apar** în interfață, în API-ul de administrare sau în export.
- Opțional, per instalare: acces la `/admin` doar din anumite rețele (listă de IP-uri în Traefik).

## 7. Accesibilitate și limbi

- WCAG 2.1 AA și pentru interfața de administrare: navigare de la tastatură, etichete, mesaje de eroare legate de câmpuri (`aria-describedby`), focus vizibil.
- Interfață în română și engleză.

## 8. Endpoint-uri (orientativ)

| Funcție | Endpoint |
|---|---|
| Configurația curentă (ciornă + publicată) | `GET /admin/api/tenants/:id/config` |
| Salvare ciornă | `PUT /admin/api/tenants/:id/config/draft` |
| Publicare | `POST /admin/api/tenants/:id/config/publish` |
| Istoric versiuni / diferențe | `GET /admin/api/tenants/:id/config/versions`, `GET .../versions/:v/diff` |
| Revenire | `POST /admin/api/tenants/:id/config/versions/:v/restore` |
| Export / import | `GET .../config/export`, `POST .../config/import` |
| Imagini | `POST /admin/api/tenants/:id/assets`, `DELETE .../assets/:assetId` |
| Token de previzualizare | `POST /admin/api/tenants/:id/preview-token` |
| Jurnal de audit | `GET /admin/api/tenants/:id/audit` |
| Clienți (super-admin) | `GET/POST /admin/api/tenants`, `PATCH /admin/api/tenants/:id` |

## 9. Criterii de acceptanță

- [ ] Un `widget-admin` al clientului A se autentifică prin Keycloak și nu poate vedea sau modifica clientul B (verificat și prin cereri directe la API, inclusiv cu un token emis de realm-ul altui client).
- [ ] Un realm de test legat prin Identity Brokering de un al doilea Keycloak (care simulează IdP-ul clientului) mapează grupurile la roluri corect.
- [ ] Un `widget-editor` poate salva ciorna, dar nu poate publica.
- [ ] Modificarea culorii, a poziției și a icon-ului butonului se vede în previzualizare imediat și în widget-ul public doar după publicare, fără repornirea gateway-ului.
- [ ] Mesajul proactiv apare deasupra butonului după intervalul configurat, fără deschiderea ferestrei.
- [ ] O combinație de culori sub contrastul AA blochează publicarea.
- [ ] Revenirea la o versiune anterioară restabilește exact configurația ei.
- [ ] Un fișier SVG sau o imagine cu extensie falsă este respinsă.
- [ ] Cheia Dify nu apare în nicio cerere, răspuns sau export al interfeței de administrare.
- [ ] Fiecare publicare apare în jurnalul de audit, cu utilizatorul și diferențele.
- [ ] Zero erori axe-core „serious” sau „critical” în interfața de administrare.
- [ ] Teste unitare, e2e (Playwright, inclusiv autentificare OIDC pe Keycloak de test) și CI trec.

## 10. În afara scopului

- Administrarea conținutului asistentului (baze de cunoștințe, prompturi, fluxuri): rămâne în Dify.
- Vizualizarea istoricului conversațiilor și rapoartele: rămân în Dify și în monitorizare.
- Modulul de întrebări și răspunsuri cu import/export xlsx și editorul de arbori de dialog din matrice: module separate.

## 11. Livrare în două tranșe

**E4b.1 — demonstrabil (prioritar)**
- Autentificare OIDC pe Keycloak de dezvoltare (`docker-compose`, realm de test cu un utilizator per rol) și roluri verificate pe server.
- Formularul de editare din §5.1, cu validare și verificarea de contrast care blochează publicarea.
- Previzualizare live (§5.2), desktop și mobil.
- Ciornă și publicare cu reîncărcare la cald (§5.3), fără vizualizarea diferențelor.
- Stocare în Postgres (sursa `TenantSource` pentru Postgres), cu seed din fișierele YAML existente.
- Încărcarea imaginilor (§5.4).
- Înregistrarea în jurnalul de audit (§5.5), fără ecran de vizualizare.
- Securitatea din §6.

**E4b.2 — completare**
- Istoric versiuni cu diferențe și revenire, export/import JSON (§5.3).
- Ecranul jurnalului de audit.
- Administrarea clienților de către `super-admin` (§5.6).
- Keycloak pe server, comun cu SSO-ul consolei Dify.
