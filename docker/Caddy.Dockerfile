# Il Caddyfile viene copiato nell'immagine in fase di build invece di essere
# montato da host: un bind mount di un singolo file non e' affidabile quando
# lo stack e' deployato da un tool come Portainer che clona il repo dentro il
# proprio volume dati (il path che vede Portainer non coincide con quello che
# vede il motore Docker sull'host, e il mount del file fallisce).
#
# Il certificato e' generato qui, in build, invece di lasciare che Caddy lo
# crei "al volo" con la sua CA interna: la selezione automatica del
# certificato di Caddy si basa su SNI/indirizzo locale della connessione, ma
# dietro il NAT del port mapping di Docker quell'indirizzo e' sempre quello
# INTERNO del container, mai l'IP esterno del server — quindi la selezione
# automatica non trova mai il certificato giusto per un accesso via IP senza
# SNI. Con un certificato fisso caricato esplicitamente non c'e' nessuna
# selezione da fare: viene sempre servito quello, punto.
FROM caddy:2-alpine
RUN apk add --no-cache openssl && \
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout /etc/caddy/key.pem -out /etc/caddy/cert.pem \
      -subj "/CN=192.168.100.5" \
      -addext "subjectAltName=IP:192.168.100.5"
COPY docker/Caddyfile /etc/caddy/Caddyfile
