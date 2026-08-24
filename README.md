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

L'indirizzo per cui Caddy genera il certificato è **scritto direttamente in
[`docker/Caddyfile`](docker/Caddyfile)** (non una variabile d'ambiente): in
alcune configurazioni di deploy da Git (Portainer incluso, nel nostro caso)
le variabili d'ambiente dello stack non arrivano all'interpolazione del
compose in modo affidabile, quindi meglio un valore esplicito nel file che
un meccanismo che silenziosamente non funziona. Se cambi server o dominio,
modifica quella riga:

```
video.tuodominio.it {
	...
}
```

oppure, per un IP:

```
192.168.1.50 {
	...
}
```

Connettendosi via IP (non dominio) il browser non manda nessun hostname
nell'handshake TLS (SNI vuoto, gli IP non ci vanno per specifica): senza
un indirizzo esplicito nel Caddyfile, Caddy non sa per quale identità
generare il certificato e l'handshake fallisce con un errore tipo
`ERR_SSL_PROTOCOL_ERROR`/`SSL_ERROR_INTERNAL_ERROR_ALERT`.

- **Dominio che punta al server**, con le porte 80/443 libere e
  raggiungibili da internet: metti il dominio come indirizzo nel Caddyfile e
  `HTTP_PORT=80`/`HTTPS_PORT=443` — Caddy ottiene da solo un certificato
  Let's Encrypt valido (la verifica ACME passa sempre dalla porta 80
  standard, su una porta diversa un dominio reale non funziona).
- **Solo IP**: metti l'IP del server come indirizzo nel Caddyfile — Caddy
  serve HTTPS con un certificato self-signed dalla sua CA interna, valido
  per quell'IP. Il browser avvisa "connessione non sicura" al primo accesso
  (normale per un certificato self-signed): si procede manualmente una
  volta, da lì in poi la connessione è comunque un secure context e
  WebCodecs funziona normalmente.

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
