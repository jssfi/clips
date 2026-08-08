const MPV_QUIT_ON_FULLSCREEN_EXIT_SCRIPT = `
local entered_fullscreen = false

mp.observe_property("fullscreen", "bool", function(_, fullscreen)
  if fullscreen then
    entered_fullscreen = true
  elseif entered_fullscreen then
    mp.command("quit")
  end
end)
`.trimStart();

function mpvFullscreenArgs(scriptPath, videoPath) {
  return [
    '--fullscreen',
    '--force-window=yes',
    '--osc=yes',
    '--hwdec=auto-safe',
    `--script=${scriptPath}`,
    videoPath
  ];
}

module.exports = { MPV_QUIT_ON_FULLSCREEN_EXIT_SCRIPT, mpvFullscreenArgs };
