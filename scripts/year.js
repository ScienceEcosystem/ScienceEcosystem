(() => {
  const year = String(new Date().getFullYear());
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.js-year').forEach((node) => {
      node.textContent = year;
    });
  });
})();
