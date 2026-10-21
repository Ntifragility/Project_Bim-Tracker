//! Pointer policy for the conduit viewport.
//!
//! Right-drag orbits. Shift+middle-drag orbits around a pivot.
//! Middle-drag pans. Neither gesture places a point or
//! clears the active rubberband. A left click places a conduit point while
//! drawing, samples elevation in pick-elevation mode, and is the only gesture
//! allowed to select an IFC element — and only when the drawing tools are off.

const DRAG_THRESHOLD_PX: f64 = 5.0;
const CLICK_MAX_MS: f64 = 600.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Action {
    None = 0,
    Orbit = 1,
    Pan = 2,
    PlacePoint = 3,
    SampleSurface = 4,
    SelectElement = 5,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolMode {
    Navigate,
    Drawing,
    PickElevation,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Decision {
    pub action: Action,
    pub preserve_rubberband: bool,
    pub allow_element_highlight: bool,
    pub azimuth_delta: f64,
    pub polar_delta: f64,
    pub truck_x: f64,
    pub truck_y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Button {
    Left,
    Middle,
    Right,
    Other,
}

#[derive(Clone, Copy, Debug)]
struct PointerDown {
    button: Button,
    origin_x: f64,
    origin_y: f64,
    last_x: f64,
    last_y: f64,
    time_ms: f64,
    moved: bool,
    shift: bool,
}

pub struct Controller {
    mode: ToolMode,
    down: Option<PointerDown>,
}

impl Controller {
    pub fn new() -> Self {
        Self {
            mode: ToolMode::Drawing,
            down: None,
        }
    }

    pub fn set_mode(&mut self, mode: ToolMode) {
        self.mode = mode;
    }

    pub fn mode(&self) -> ToolMode {
        self.mode
    }

    pub fn allow_highlight(&self) -> bool {
        matches!(self.mode, ToolMode::Navigate)
    }

    pub fn pointer_down(&mut self, button: u8, x: f64, y: f64, time_ms: f64) -> Decision {
        self.pointer_down_with_shift(button, x, y, time_ms, false)
    }

    pub fn pointer_down_with_shift(
        &mut self,
        button: u8,
        x: f64,
        y: f64,
        time_ms: f64,
        shift: bool,
    ) -> Decision {
        self.down = Some(PointerDown {
            button: button_from_code(button),
            origin_x: x,
            origin_y: y,
            last_x: x,
            last_y: y,
            time_ms,
            moved: false,
            shift,
        });
        self.idle_decision()
    }

    pub fn pointer_move(
        &mut self,
        x: f64,
        y: f64,
        _time_ms: f64,
        camera_distance: f64,
        viewport_height: f64,
    ) -> Decision {
        let Some((dx, dy, button, moved, shift)) = self.step(x, y) else {
            return self.idle_decision();
        };
        self.drag_decision(button, moved, shift, dx, dy, camera_distance, viewport_height)
    }

    pub fn pointer_up(
        &mut self,
        x: f64,
        y: f64,
        time_ms: f64,
        camera_distance: f64,
        viewport_height: f64,
    ) -> Decision {
        let Some(down) = self.down else {
            return self.idle_decision();
        };
        let (dx, dy, button, moved, shift) =
            self.step(x, y).unwrap_or((0.0, 0.0, down.button, down.moved, down.shift));
        let elapsed = time_ms - down.time_ms;
        self.down = None;

        if moved {
            return self.drag_decision(button, true, shift, dx, dy, camera_distance, viewport_height);
        }

        if button == Button::Left && elapsed <= CLICK_MAX_MS {
            let action = match self.mode {
                ToolMode::PickElevation => Action::SampleSurface,
                ToolMode::Drawing => Action::PlacePoint,
                ToolMode::Navigate => Action::SelectElement,
            };
            return self.decision(action, 0.0, 0.0, 0.0, 0.0);
        }

        self.idle_decision()
    }

    fn step(&mut self, x: f64, y: f64) -> Option<(f64, f64, Button, bool, bool)> {
        let down = self.down.as_mut()?;
        let dx = x - down.last_x;
        let dy = y - down.last_y;
        down.last_x = x;
        down.last_y = y;
        let travel = (x - down.origin_x).hypot(y - down.origin_y);
        if travel > DRAG_THRESHOLD_PX {
            down.moved = true;
        }
        Some((dx, dy, down.button, down.moved, down.shift))
    }

    fn drag_decision(
        &self,
        button: Button,
        moved: bool,
        shift: bool,
        dx: f64,
        dy: f64,
        camera_distance: f64,
        viewport_height: f64,
    ) -> Decision {
        if !moved {
            return self.idle_decision();
        }
        let orbit_with_left = button == Button::Left && self.mode == ToolMode::Navigate;
        match button {
            Button::Right => {
                let (azimuth, polar) = orbit_deltas(dx, dy, viewport_height);
                self.decision(Action::Orbit, azimuth, polar, 0.0, 0.0)
            }
            Button::Left if orbit_with_left => {
                let (azimuth, polar) = orbit_deltas(dx, dy, viewport_height);
                self.decision(Action::Orbit, azimuth, polar, 0.0, 0.0)
            }
            Button::Middle if shift => {
                let (azimuth, polar) = orbit_deltas(dx, dy, viewport_height);
                self.decision(Action::Orbit, azimuth, polar, 0.0, 0.0)
            }
            Button::Middle => {
                let (truck_x, truck_y) = pan_deltas(dx, dy, camera_distance, viewport_height);
                self.decision(Action::Pan, 0.0, 0.0, truck_x, truck_y)
            }
            Button::Left | Button::Other => self.idle_decision(),
        }
    }

    fn idle_decision(&self) -> Decision {
        self.decision(Action::None, 0.0, 0.0, 0.0, 0.0)
    }

    fn decision(
        &self,
        action: Action,
        azimuth_delta: f64,
        polar_delta: f64,
        truck_x: f64,
        truck_y: f64,
    ) -> Decision {
        Decision {
            action,
            preserve_rubberband: true,
            allow_element_highlight: self.allow_highlight(),
            azimuth_delta,
            polar_delta,
            truck_x,
            truck_y,
        }
    }
}

impl Default for Controller {
    fn default() -> Self {
        Self::new()
    }
}

fn button_from_code(button: u8) -> Button {
    match button {
        0 => Button::Left,
        1 => Button::Middle,
        2 => Button::Right,
        _ => Button::Other,
    }
}

/// Full turn across the viewport height, the same scale camera-controls uses for a drag.
fn orbit_deltas(dx: f64, dy: f64, viewport_height: f64) -> (f64, f64) {
    let height = viewport_height.max(1.0);
    let scale = std::f64::consts::TAU / height;
    (dx * scale, dy * scale)
}

/// Grab-pan. Dragging right moves the target left so the surface stays under the cursor.
fn pan_deltas(dx: f64, dy: f64, camera_distance: f64, viewport_height: f64) -> (f64, f64) {
    let height = viewport_height.max(1.0);
    let distance = camera_distance.max(0.05);
    let scale = distance / height;
    (-dx * scale, dy * scale)
}

fn drawing() -> Controller {
    let mut controller = Controller::new();
    controller.set_mode(ToolMode::Drawing);
    controller
}

fn drag(controller: &mut Controller, button: u8, from: (f64, f64), to: (f64, f64)) -> Decision {
    controller.pointer_down(button, from.0, from.1, 0.0);
    controller.pointer_move(to.0, to.1, 16.0, 10.0, 800.0)
}

/// Returns 0 when every viewport rule holds, otherwise the id of the first failure.
/// Runs inside WebAssembly, so the module can be checked without a host linker.
pub fn self_test() -> i32 {
    let mut orbit = drawing();
    let orbit_decision = drag(&mut orbit, 2, (0.0, 0.0), (40.0, 0.0));
    if orbit_decision.action != Action::Orbit
        || !orbit_decision.preserve_rubberband
        || orbit_decision.allow_element_highlight
        || orbit_decision.azimuth_delta <= 0.0
        || orbit_decision.polar_delta != 0.0
        || orbit_decision.truck_x != 0.0
    {
        return 1;
    }

    let mut pan = drawing();
    let pan_decision = drag(&mut pan, 1, (0.0, 0.0), (80.0, 0.0));
    if pan_decision.action != Action::Pan
        || !pan_decision.preserve_rubberband
        || pan_decision.allow_element_highlight
        || (pan_decision.truck_x + 1.0).abs() >= 1e-9
        || pan_decision.truck_y != 0.0
    {
        return 2;
    }

    let mut place = drawing();
    place.pointer_down(0, 10.0, 10.0, 1_000.0);
    let place_decision = place.pointer_up(12.0, 11.0, 1_200.0, 10.0, 800.0);
    if place_decision.action != Action::PlacePoint
        || !place_decision.preserve_rubberband
        || place_decision.allow_element_highlight
    {
        return 3;
    }

    let mut sample = Controller::new();
    sample.set_mode(ToolMode::PickElevation);
    sample.pointer_down(0, 4.0, 4.0, 0.0);
    let sample_decision = sample.pointer_up(4.0, 4.0, 100.0, 10.0, 800.0);
    if sample_decision.action != Action::SampleSurface
        || sample_decision.allow_element_highlight
        || !sample_decision.preserve_rubberband
    {
        return 4;
    }

    let mut override_mode = drawing();
    override_mode.set_mode(ToolMode::PickElevation);
    override_mode.pointer_down(0, 0.0, 0.0, 0.0);
    if override_mode.pointer_up(1.0, 1.0, 50.0, 10.0, 800.0).action != Action::SampleSurface {
        return 5;
    }

    let mut select = Controller::new();
    select.set_mode(ToolMode::Navigate);
    select.pointer_down(0, 0.0, 0.0, 0.0);
    let select_decision = select.pointer_up(1.0, 0.0, 40.0, 10.0, 800.0);
    if select_decision.action != Action::SelectElement || !select_decision.allow_element_highlight {
        return 6;
    }

    let mut left_drag = drawing();
    let moved = drag(&mut left_drag, 0, (0.0, 0.0), (30.0, 0.0));
    let up = left_drag.pointer_up(30.0, 0.0, 80.0, 10.0, 800.0);
    if moved.action != Action::None
        || !moved.preserve_rubberband
        || moved.allow_element_highlight
        || up.action != Action::None
        || !up.preserve_rubberband
    {
        return 7;
    }

    let mut right_click = drawing();
    right_click.pointer_down(2, 8.0, 8.0, 0.0);
    let right_decision = right_click.pointer_up(8.0, 9.0, 90.0, 10.0, 800.0);
    if right_decision.action != Action::None || !right_decision.preserve_rubberband {
        return 8;
    }

    let mut long_press = drawing();
    long_press.pointer_down(0, 0.0, 0.0, 0.0);
    let long_decision = long_press.pointer_up(0.0, 0.0, 800.0, 10.0, 800.0);
    if long_decision.action != Action::None || !long_decision.preserve_rubberband {
        return 9;
    }

    for mode in [ToolMode::Drawing, ToolMode::PickElevation] {
        let mut controller = Controller::new();
        controller.set_mode(mode);
        let decision = controller.pointer_down(0, 0.0, 0.0, 0.0);
        if decision.allow_element_highlight || !decision.preserve_rubberband {
            return 10;
        }
    }

    let mut accumulated = drawing();
    accumulated.pointer_down(2, 0.0, 0.0, 0.0);
    let first = accumulated.pointer_move(40.0, 0.0, 16.0, 10.0, 800.0);
    let second = accumulated.pointer_move(50.0, 0.0, 32.0, 10.0, 800.0);
    let expected = std::f64::consts::TAU * 50.0 / 800.0;
    if (first.azimuth_delta + second.azimuth_delta - expected).abs() >= 1e-9 {
        return 11;
    }

    let mut shift_orbit = Controller::new();
    shift_orbit.set_mode(ToolMode::Navigate);
    shift_orbit.pointer_down_with_shift(0, 0.0, 0.0, 0.0, true);
    let shift_decision = shift_orbit.pointer_move(40.0, 0.0, 16.0, 10.0, 800.0);
    if shift_decision.action != Action::Orbit || shift_decision.azimuth_delta <= 0.0 {
        return 12;
    }

    let mut shift_while_drawing = drawing();
    shift_while_drawing.pointer_down_with_shift(0, 0.0, 0.0, 0.0, true);
    let drawing_shift = shift_while_drawing.pointer_move(40.0, 0.0, 16.0, 10.0, 800.0);
    if drawing_shift.action != Action::None || !drawing_shift.preserve_rubberband {
        return 13;
    }

    let mut plain_left = Controller::new();
    plain_left.set_mode(ToolMode::Navigate);
    plain_left.pointer_down(0, 0.0, 0.0, 0.0);
    if plain_left.pointer_move(40.0, 0.0, 16.0, 10.0, 800.0).action != Action::Orbit {
        return 14;
    }

    let mut pivot = drawing();
    pivot.pointer_down_with_shift(1, 0.0, 0.0, 0.0, true);
    let pivot_decision = pivot.pointer_move(36.0, 12.0, 16.0, 10.0, 800.0);
    if pivot_decision.action != Action::Orbit
        || !pivot_decision.preserve_rubberband
        || pivot_decision.truck_x != 0.0
    {
        return 15;
    }

    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewport_rules_hold() {
        assert_eq!(self_test(), 0);
    }
}
