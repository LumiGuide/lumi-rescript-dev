var listener;
var LAST_SUCCESS_BUILD_STAMP = localStorage.getItem('LAST_SUCCESS_BUILD_STAMP') || 0;
var listen = () => {
  if (listener && listener.readyState !== 2) {
    return
  }
  listener = new EventSource("/esbuild")
  listener.addEventListener('message', (message) => {
    var newData = JSON.parse(message.data).LAST_SUCCESS_BUILD_STAMP;
    if (newData > LAST_SUCCESS_BUILD_STAMP) {
      LAST_SUCCESS_BUILD_STAMP = newData;
      localStorage.setItem('LAST_SUCCESS_BUILD_STAMP', LAST_SUCCESS_BUILD_STAMP);
      location.reload();
    }
  })
}
listen()
setInterval(listen, 2000)
