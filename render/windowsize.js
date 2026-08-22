/**
 * What window size DELTARUNE itself opens at, translated from `obj_time`'s
 * Create (gml_Object_obj_time_Create_0.gml, lines 40-52):
 *
 *     var display_height = display_get_height();
 *     var display_width = display_get_width();
 *     window_size_multiplier = 1;
 *     for (var _ww = 2; _ww < 12; _ww += 1)
 *     {
 *         if (display_width > (640 * _ww) && display_height > (480 * _ww))
 *         {
 *             window_size_multiplier = _ww;
 *         }
 *     }
 *     if (window_size_multiplier > 1 && !fullscreen_option)
 *         window_set_size(640 * window_size_multiplier, 480 * window_size_multiplier);
 *
 * Four details that each change the answer:
 *
 *   1. The comparison is STRICT. A display of exactly 1280x960 gets 1x, not
 *      2x, because `1280 > 1280` is false. Translating it as `>=` doubles the
 *      window on exactly the displays that match the frame.
 *   2. BOTH axes must clear the bar. A 1470x956 laptop panel is wide enough
 *      for 2x and four rows short, so it gets 1x -- the height is usually
 *      what decides, since 480 * n grows faster against a 16:9 screen.
 *   3. The loop caps at 11 (`_ww < 12`) and the running value starts at 1, so
 *      a display too small for 2x still gets a whole 1x window rather than 0.
 *   4. It measures the DISPLAY, not the window, and `display_get_width`
 *      returns logical points on macOS -- which is why the game opens at
 *      1280x960 on a Retina laptop instead of at the backing size. Callers
 *      must pass CSS pixels, NOT device pixels; feeding it device pixels
 *      reports 4x on a 2x display.
 *
 * Pure on purpose: `verify-windowsize` pins every one of those against a
 * table, which a function reading `screen` directly could not be tested for.
 */
export function deltaruneMultiplier(displayW, displayH, frameW = 640, frameH = 480) {
  let m = 1;
  for (let w = 2; w < 12; w += 1) {
    if (displayW > frameW * w && displayH > frameH * w) m = w;
  }
  return m;
}
