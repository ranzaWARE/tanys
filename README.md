# tanys

Il nome viene da *Tanystropheus*, il rettile del Triassico dal collo
spropositatamente lungo — la stessa immagine di una timeline che si allunga
clip dopo clip.

Video editor browser-based: decode, composizione ed export girano nel browser
(hardware-accelerated via WebCodecs/WebGL, GPU del client se disponibile),
niente transcoding lato server. Ispirato a [OpenCut](https://github.com/OpenCut-app/OpenCut)
(versione `pre-rewrite`), design system **AUROR**, con un modulo dedicato ai
video 360° (stitch dual-fisheye Insta360 + reframe con camera virtuale).

Piano di sviluppo completo (fasi, architettura, decisioni): [`Fase 1` in corso].

## Sviluppo locale

```sh
npm install
npm run dev
# apri http://localhost:3000
```

## Docker

Il compose è autosufficiente: include Caddy davanti a `web` per servire
tutto in HTTPS senza dover configurare nulla altrove (utile per far girare
lo stack anche su un host che non ha già un reverse proxy come NPM). Il
Caddyfile è "cotto" dentro l'immagine in fase di build, non montato da
host — evita un bug noto di Portainer/deploy-da-Git in cui il bind mount di
un singolo file fallisce perché il path clonato da Portainer non coincide
con quello visto dal motore Docker.

```sh
docker compose up --build
# apri https://<indirizzo-del-server>:8843
```

Porte di default `8880`/`8843` (non `80`/`443`, per non entrare in conflitto
con altri stack — es. un Nginx Proxy Manager già presente sullo stesso host).
Si cambiano con `HTTP_PORT`/`HTTPS_PORT` in un file `.env` accanto a
`docker-compose.yml` se dovessero collidere anche loro con qualcos'altro:

```
HTTP_PORT=8880
HTTPS_PORT=8843
```

**Il certificato è generato in fase di build** (in
[`docker/Caddy.Dockerfile`](docker/Caddy.Dockerfile), via `openssl`) e
caricato esplicitamente nel Caddyfile con `tls cert.pem key.pem`, invece di
lasciare che Caddy lo generi "al volo" con la sua gestione automatica.
Motivo: connettendosi via IP (non dominio) il browser non manda nessun
hostname nell'handshake TLS (niente SNI, gli IP non ci vanno per specifica),
e dietro il NAT del port mapping di Docker l'indirizzo locale che Caddy vede
in una connessione è sempre quello *interno* del container, mai l'IP esterno
del server digitato dal client — quindi qualunque meccanismo di selezione
automatica del certificato (per SNI o per indirizzo) non trova mai quello
giusto, e l'handshake fallisce con errori tipo
`ERR_SSL_PROTOCOL_ERROR`/`SSL_ERROR_INTERNAL_ERROR_ALERT`. Con un certificato
fisso caricato esplicitamente non c'è nessuna selezione da fare: viene
sempre servito quello.

Se cambi server o IP, aggiorna il CN/SAN in `docker/Caddy.Dockerfile`:

```
openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout /etc/caddy/key.pem -out /etc/caddy/cert.pem \
  -subj "/CN=<nuovo-ip>" \
  -addext "subjectAltName=IP:<nuovo-ip>"
```

e rebuilda (`docker compose up --build`). Il browser avviserà "connessione
non sicura" al primo accesso (normale per un certificato self-signed): si
procede manualmente una volta, da lì in poi la connessione è comunque un
secure context e WebCodecs funziona normalmente.

Per un **dominio reale con certificato Let's Encrypt automatico** (niente
avviso del browser) serve invece la gestione automatica di Caddy, non questo
meccanismo a certificato fisso — chiedimi di rifare questa parte del
Caddyfile se ti serve quel caso.

Se preferisci usare un reverse proxy che hai già (es. Nginx Proxy Manager)
invece del Caddy incluso: togli il servizio `caddy` da `docker-compose.yml`,
pubblica `web` su una porta host libera, e punta un Proxy Host del tuo
reverse proxy lì — funziona altrettanto bene, è solo un servizio in più da
gestire a mano invece che incluso nello stack.

> **Importante — serve HTTPS vero, qualunque strada scegli.** WebCodecs
> (`VideoEncoder`/`VideoFrame`, il cuore dell'export hardware-accelerated) è
> una API riservata ai *secure context*: in plain HTTP il browser lo blocca,
> il badge in header mostrerà "GPU: no" e l'export fallirà con "questo
> browser non supporta WebCodecs" — non è un bug del codice, è la policy del
> browser.

Fase 1: nessuna persistenza ancora (stato del progetto solo in memoria nel
browser) — la persistenza progetti/media (Postgres) arriva in Fase 4.

## Build riproducibile / standalone

Il progetto non dipende da nessun repo o servizio esterno per funzionare:
niente CDN a runtime (font di sistema, non Google Fonts), Docker builda tutto
da solo, l'unica cosa esterna resta `npm install` che scarica i pacchetti
da npm — ma le versioni sono fissate (non `^range`) dove è stato verificato
un numero esatto funzionante, così un rebuild non prende silenziosamente una
versione più recente e diversa da quella testata.

Manca ancora un pezzo per la riproducibilità totale: un `package-lock.json`
committato, che blocca *anche* tutte le dipendenze indirette (non solo quelle
dirette in `package.json`) a un hash preciso. Non posso generarlo da questa
sessione (serve un vero `npm install` in un ambiente con Node, che qui non
ho). Se hai un momento con Node disponibile — il tuo PC, una Codespace, un
runner CI, o anche il "Console" di un container temporaneo da Portainer —
basta:

```sh
npm install --package-lock-only
git add package-lock.json
git commit   # l'hook genera il messaggio da solo
git push
```

Da quel momento in poi `npm install` nel Dockerfile userà automaticamente il
lockfile per risolvere le stesse identiche versioni ogni volta.

## Commit automatici

L'hook `.githooks/prepare-commit-msg` genera da solo il messaggio quando se
ne committa senza scriverne uno (es. dalla Source Control di VSCode con la
casella vuota): se la CLI `claude` è disponibile nella shell chiede un
riassunto in una riga del diff in staging, altrimenti ripiega su un
riepilogo basato sui file cambiati. Si attiva da solo al primo `npm install`
(script `postinstall`, imposta `core.hooksPath`); non tocca mai un commit
per cui è già stato scritto un messaggio, un merge, uno squash o un amend.

## Struttura

```
apps/web/               Next.js: editor, player, timeline
packages/design-tokens/  design system AUROR (CSS)
packages/video-engine/   motore client-side: decode <video>+WebGL, export WebCodecs+mp4-muxer
reference/reframe360.html  prototipo dual-fisheye 360, riferimento per la Fase 3
```
