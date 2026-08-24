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

Il compose è autonomo: include Caddy davanti al servizio `web` per servire
tutto in HTTPS senza configurazione extra (necessario perché WebCodecs,
l'export hardware-accelerated, funziona solo in *secure context* — su un IP
o dominio raggiunto in plain HTTP il browser lo blocca e basta).

```sh
docker compose -f docker/docker-compose.yml up --build
# apri https://<indirizzo-del-server>
```

- **Hai un dominio che punta al server** (porte 80/443 raggiungibili da
  internet): imposta `SITE_ADDRESS=video.tuodominio.it` (in un file `.env`
  accanto a `docker-compose.yml`, o `SITE_ADDRESS=... docker compose up`).
  Caddy ottiene da solo un certificato Let's Encrypt valido.
- **Solo IP, nessun dominio**: non serve fare nulla, `SITE_ADDRESS` di default
  è `:443` — Caddy serve HTTPS con un certificato self-signed dalla sua CA
  interna. Il browser mostrerà un avviso "connessione non sicura" al primo
  accesso: si procede manualmente una volta e da lì in poi la connessione è
  comunque un secure context, WebCodecs funziona normalmente.

Fase 1: nessuna persistenza ancora (stato del progetto solo in memoria nel
browser) — la persistenza progetti/media (Postgres) arriva in Fase 4.

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
