use std::cell::RefCell;

use crate::controller::{Action, Controller, Decision, ToolMode};

thread_local! {
    static CONTROLLER: RefCell<Controller> = RefCell::new(Controller::new());
    static LAST: RefCell<Decision> = RefCell::new(Decision {
        action: Action::None,
        preserve_rubberband: true,
        allow_element_highlight: false,
        azimuth_delta: 0.0,
        polar_delta: 0.0,
        truck_x: 0.0,
        truck_y: 0.0,
    });
}

fn store(decision: Decision) {
    LAST.with(|slot| *slot.borrow_mut() = decision);
}

#[no_mangle]
pub extern "C" fn viewport_self_test() -> i32 {
    crate::controller::self_test()
}

#[no_mangle]
pub extern "C" fn viewport_set_mode(mode: u32) {
    let tool_mode = match mode {
        1 => ToolMode::Drawing,
        2 => ToolMode::PickElevation,
        _ => ToolMode::Navigate,
    };
    CONTROLLER.with(|slot| slot.borrow_mut().set_mode(tool_mode));
}

#[no_mangle]
pub extern "C" fn viewport_allow_highlight() -> u32 {
    CONTROLLER.with(|slot| u32::from(slot.borrow().allow_highlight()))
}

#[no_mangle]
pub extern "C" fn viewport_pointer_down(button: u32, x: f64, y: f64, time_ms: f64, shift: u32) {
    let decision = CONTROLLER.with(|slot| {
        slot.borrow_mut().pointer_down_with_shift(button as u8, x, y, time_ms, shift != 0)
    });
    store(decision);
}

#[no_mangle]
pub extern "C" fn viewport_pointer_move(
    x: f64,
    y: f64,
    time_ms: f64,
    camera_distance: f64,
    viewport_height: f64,
) {
    let decision = CONTROLLER.with(|slot| {
        slot.borrow_mut().pointer_move(x, y, time_ms, camera_distance, viewport_height)
    });
    store(decision);
}

#[no_mangle]
pub extern "C" fn viewport_pointer_up(
    x: f64,
    y: f64,
    time_ms: f64,
    camera_distance: f64,
    viewport_height: f64,
) {
    let decision = CONTROLLER.with(|slot| {
        slot.borrow_mut().pointer_up(x, y, time_ms, camera_distance, viewport_height)
    });
    store(decision);
}

#[no_mangle]
pub extern "C" fn viewport_decision_action() -> u32 {
    LAST.with(|slot| slot.borrow().action as u32)
}

#[no_mangle]
pub extern "C" fn viewport_decision_preserve() -> u32 {
    LAST.with(|slot| u32::from(slot.borrow().preserve_rubberband))
}

#[no_mangle]
pub extern "C" fn viewport_decision_highlight() -> u32 {
    LAST.with(|slot| u32::from(slot.borrow().allow_element_highlight))
}

#[no_mangle]
pub extern "C" fn viewport_decision_azimuth() -> f64 {
    LAST.with(|slot| slot.borrow().azimuth_delta)
}

#[no_mangle]
pub extern "C" fn viewport_decision_polar() -> f64 {
    LAST.with(|slot| slot.borrow().polar_delta)
}

#[no_mangle]
pub extern "C" fn viewport_decision_truck_x() -> f64 {
    LAST.with(|slot| slot.borrow().truck_x)
}

#[no_mangle]
pub extern "C" fn viewport_decision_truck_y() -> f64 {
    LAST.with(|slot| slot.borrow().truck_y)
}
