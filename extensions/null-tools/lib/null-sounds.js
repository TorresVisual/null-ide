(function () {
  var _ctx = null;

  function getCtx() {
    if (!_ctx) { try { _ctx = new AudioContext(); } catch (_) { return null; } }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function tone(freq, dur, vol) {
    var ctx = getCtx();
    if (!ctx) return;
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  var SOUNDS = {
    save: function () {
      tone(880,  0.07, 0.04);
      setTimeout(function () { tone(1318, 0.10, 0.025); }, 55);
    },
    open: function () {
      tone(660, 0.09, 0.035);
    },
  };

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (d && d.type === 'playSound' && SOUNDS[d.name]) {
      try { SOUNDS[d.name](); } catch (_) {}
    }
  });
}());
