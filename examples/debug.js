const { Stream } = require("../dist/stream");

(async function () {
  await Stream.from(['Hello', 'a', 'World', 'b', 'foobarbaz', 'a']).throttle(200, {
    maximumBurst: 10,
    costCalculation: str => str.length
  }).log('Coucou').run();
})()
