/* Loads the vendored pdf.js.

   Since v4 pdf.js ships only as ES modules, so it cannot sit in a plain
   <script> tag the way it used to. A dynamic import() is allowed by the page's
   `script-src 'self'` policy, so this imports it once, points it at its
   (module) worker and publishes the same window.pdfjsLib global the editors
   have always used. Code that needs pdf.js awaits window.pdfjsReady, which
   resolves to the library, or to null when it could not be loaded. */
(function () {
  const base = document.baseURI;
  window.pdfjsReady = import(new URL('vendor/pdf.min.mjs', base).href)
    .then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', base).href;
      window.pdfjsLib = lib;
      return lib;
    })
    .catch((err) => {
      console.error('pdf.js could not be loaded', err);
      return null;
    });
})();
