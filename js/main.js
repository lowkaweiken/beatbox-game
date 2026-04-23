import { startMode, startMicTest, stopListening, startCalibrationFlow, recordBackground } from './audio.js';
import { restartGame, startTimedGame, playAgain, adjustLatency, adjustBPM, adjustCooldown, adjustHitbox } from './game.js';
import { finishCalibration, recalibrate, advanceClass, discardLastSample } from './calibration.js';
import { loadCentroids } from './storage.js';
import { state } from './state.js';

const ADJUST = {
  'adjust-latency':  adjustLatency,
  'adjust-bpm':      adjustBPM,
  'adjust-hitbox':   adjustHitbox,
  'adjust-cooldown': adjustCooldown,
};

document.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const fn = ADJUST[btn.dataset.action];
  if (fn) fn(parseInt(btn.dataset.delta, 10));
});

document.getElementById('btn-mic-test').addEventListener('click', startMicTest);
document.getElementById('btn-infinite').addEventListener('click', () => startMode('infinite'));
document.getElementById('btn-timed').addEventListener('click', () => startMode('timed'));
document.getElementById('restart-btn').addEventListener('click', restartGame);
document.getElementById('stop-btn').addEventListener('click', stopListening);
document.getElementById('param-start-btn').addEventListener('click', startTimedGame);
document.getElementById('report-play-again').addEventListener('click', playAgain);
document.getElementById('report-home-btn').addEventListener('click', stopListening);

// Calibration buttons
document.getElementById('btn-calibrate').addEventListener('click', startCalibrationFlow);

document.getElementById('btn-recalibrate').addEventListener('click', async () => {
  await recalibrate();
  startCalibrationFlow();
});

document.getElementById('cal-record-bg-btn').addEventListener('click', recordBackground);

document.getElementById('cal-discard-btn').addEventListener('click', discardLastSample);

document.getElementById('cal-advance-btn').addEventListener('click', advanceClass);

document.getElementById('cal-done-btn').addEventListener('click', async () => {
  try {
    await finishCalibration();
    stopListening();
    exitCalibrationView(true);
  } catch (err) {
    console.error('[calibration] finishCalibration failed:', err);
    alert('Calibration failed: ' + err.message + '\nPlease record samples for all classes.');
  }
});

document.getElementById('cal-cancel-btn').addEventListener('click', () => {
  const wasCalibrated = !!state.centroids;
  stopListening();
  exitCalibrationView(wasCalibrated);
});

function exitCalibrationView(calibrated) {
  document.getElementById('calibration-view').style.display = 'none';
  document.getElementById('home-view').style.display = 'flex';
  updateHomeCalibrationState(calibrated);
}

function updateHomeCalibrationState(calibrated) {
  document.getElementById('btn-calibrate').style.display = calibrated ? 'none' : 'block';
  document.getElementById('btn-recalibrate').style.display = calibrated ? 'inline-block' : 'none';
  document.getElementById('cal-gate-hint').style.display = calibrated ? 'none' : 'block';
  document.getElementById('btn-infinite').disabled = !calibrated;
  document.getElementById('btn-timed').disabled = !calibrated;
  // Restore button text in case it was changed by startCalibrationFlow
  const calBtn = document.getElementById('btn-calibrate');
  calBtn.textContent = '⚙ CALIBRATE YOUR SOUNDS';
  calBtn.disabled = false;
}

// On load: check IndexedDB for existing calibration
loadCentroids().then(centroids => {
  updateHomeCalibrationState(!!centroids);
});
