# Il Caddyfile viene copiato nell'immagine in fase di build invece di essere
# montato da host: un bind mount di un singolo file non e' affidabile quando
# lo stack e' deployato da un tool come Portainer che clona il repo dentro il
# proprio volume dati (il path che vede Portainer non coincide con quello che
# vede il motore Docker sull'host, e il mount del file fallisce).
FROM caddy:2-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
