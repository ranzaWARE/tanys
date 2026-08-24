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

Il compose contiene solo `web` — niente reverse proxy incluso, perché la
gestione di HTTPS/dominio la fai col tuo **Nginx Proxy Manager** già in uso
per gli altri servizi sullo stesso host (aggiungerne un secondo dentro questo
stack avrebbe solo creato conflitti di porte).

```sh
docker compose up --build
```

Pubblica il servizio sulla porta host `3000` di default (cambiabile con
`WEB_PORT` in un file `.env` accanto a `docker-compose.yml`, se ti serve
un'altra porta libera). Poi in NPM:

1. **Proxy Hosts → Add Proxy Host**
2. Domain: il sottodominio che vuoi usare (es. `video.tuodominio.it`)
3. Forward Hostname/IP: l'IP del server (o il nome del container `tanys-web-1`
   se NPM gira sulla stessa rete Docker), Forward Port: `3000` (o il valore
   di `WEB_PORT`)
4. Tab **SSL** → richiedi un certificato Let's Encrypt, attiva **Force SSL**

> **Importante — serve HTTPS vero.** WebCodecs (`VideoEncoder`/`VideoFrame`,
> il cuore dell'export hardware-accelerated) è una API riservata ai *secure
> context*: senza il certificato attivato in NPM (o su un IP/dominio in plain
> HTTP) il browser lo blocca, il badge in header mostrerà "GPU: no" e
> l'export fallirà con "questo browser non supporta WebCodecs" — non è un
> bug del codice, è la policy del browser.

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
