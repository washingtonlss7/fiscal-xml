'use strict';
/*
 * Service worker do Appura (app instalável).
 * - Guarda só a "casca" do painel (HTML, JS, CSS e ícones) para abrir rápido e sem internet.
 * - Busca sempre a versão nova primeiro; a cópia guardada só é usada quando a rede falha.
 * - Nunca guarda nada de /api: notas, empresas e dados fiscais não ficam no aparelho.
 */
const VERSAO = 'appura-casca-v1';
const CASCA = ['/', '/app.js', '/app.css', '/icone.svg', '/manifest.webmanifest', '/icone-192.png', '/icone-512.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const chave = req.mode === 'navigate' ? '/' : url.pathname;
  if (!CASCA.includes(chave)) return;
  ev.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put(chave, copia));
        }
        return resp;
      })
      .catch(() => caches.match(chave).then((r) => r || Response.error())),
  );
});
