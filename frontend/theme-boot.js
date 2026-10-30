(function () {
  try {
    var theme = localStorage.getItem("zh-theme");
    document.documentElement.dataset.theme = ["ice", "graphite", "aurora", "sand"].includes(theme)
      ? theme
      : "ice";
  } catch (error) {
    document.documentElement.dataset.theme = "ice";
  }
})();
