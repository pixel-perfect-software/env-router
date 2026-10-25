//! Centres the close, minimise and zoom buttons on the titlebar band.
//!
//! The window has an overlay titlebar (`titleBarStyle: Overlay`), so the band is the 52 px strip
//! the frontend draws (`Titlebar.tsx`), and the icon and the view switch sit on its centre line.
//! `trafficLightPosition` can't put the buttons there. tao's inset (`inset_traffic_lights`) makes
//! AppKit's titlebar container as tall as a button plus `y` and moves each button sideways, but a
//! button's vertical place in the container is whatever AppKit last gave it: 9 pt above the
//! container's bottom edge, and it stays there while the container grows. Measured on macOS 27.2
//! with `y` 24, that is a 38 pt container and a centre 22 pt below the window's top (`y - 2`);
//! 1e7f731 had measured `y + 2.5`. AppKit also resets the container to its default 32 pt and
//! the buttons to that 9 pt on a resize, and tao makes the container tall again on its next
//! redraw, so the result depends on which came last.
//!
//! So this takes the container's frame itself, exactly as tao does (a button's height plus the
//! configured `y`, pinned to the window's top), and then puts each button's centre `BAND_CENTRE`
//! below the window's top, worked out in window coordinates so it doesn't matter which view the
//! button is in or which way its axis points. It doesn't read what AppKit or tao left, so no
//! redraw has to follow a reset, and running it again, or tao redrawing afterwards, changes
//! nothing. tao keeps `x`. It runs after the events that can make AppKit lay the titlebar out
//! afresh, on the main thread already when the event comes from there, so the change lands before
//! the next draw.

// AppKit is an Objective-C API. Each call below is a message to a view of the window's own
// titlebar, made on the main thread, and nothing is kept past the call.
#![allow(unsafe_code)]

use std::sync::OnceLock;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowStyleMask};
use tauri::{Manager, Window};

/// The frontend's titlebar band, in points (`h-[52px]` in `Titlebar.tsx`, which has no
/// responsive height; a test holds the two together).
const BAND_HEIGHT: f64 = 52.0;

/// Where the icon and the view switch are centred, measured from the window's top.
const BAND_CENTRE: f64 = BAND_HEIGHT / 2.0;

/// A view already this close (in points) to where it should be stays where it is.
const TOLERANCE: f64 = 0.01;

/// The three buttons, left to right.
const BUTTONS: [NSWindowButton; 3] = [
    NSWindowButton::CloseButton,
    NSWindowButton::MiniaturizeButton,
    NSWindowButton::ZoomButton,
];

/// The `y` of `trafficLightPosition`, read once: the configuration doesn't change while the app
/// runs. `None` for a window without an inset, whose buttons stay where AppKit puts them.
static INSET_Y: OnceLock<Option<f64>> = OnceLock::new();

/// How far from the window's top a button of `button_height` has its bottom edge when its
/// centre is on the band's centre line.
fn bottom_edge(button_height: f64) -> f64 {
    BAND_CENTRE + button_height / 2.0
}

/// Whether the container, `container_height` tall from the window's top, holds the buttons
/// when they are on the centre line. The smallest `y` that does is the band's centre line plus
/// half a button, less the button: 19 for a 14 pt one.
fn fits(container_height: f64, button_height: f64) -> bool {
    container_height >= bottom_edge(button_height)
}

/// The y, in window coordinates (pointing up from the window's bottom edge), of the bottom of a
/// button of `button_height` centred on the band, in a window `window_height` tall.
fn button_bottom(window_height: f64, button_height: f64) -> f64 {
    window_height - bottom_edge(button_height)
}

/// Puts the buttons on the band's centre line. Does nothing in full screen, where the system
/// draws them in its own toolbar, or before the window exists.
pub fn centre(window: &Window) {
    let inset_y = INSET_Y.get_or_init(|| {
        window
            .app_handle()
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == window.label())
            .and_then(|config| config.traffic_light_position.as_ref())
            .map(|inset| inset.y)
    });
    let Some(inset_y) = *inset_y else { return };
    // AppKit views belong to the main thread. A window event is already on it, and queuing
    // would let AppKit draw the default place first.
    if let Some(main) = MainThreadMarker::new() {
        place(window, inset_y, main);
    } else {
        let on_main = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Some(main) = MainThreadMarker::new() {
                place(&on_main, inset_y, main);
            }
        });
    }
}

/// The work of [`centre`], on the main thread (which `_main` vouches for).
fn place(window: &Window, inset_y: f64, _main: MainThreadMarker) {
    let Ok(ptr) = window.ns_window() else { return };
    // SAFETY: `ns_window` returns the live NSWindow behind this window, which stays alive for
    // the rest of this call; it runs on the main thread, as AppKit requires.
    let ns_window = unsafe { &*ptr.cast::<NSWindow>() };
    // In full screen the buttons live in the system's own toolbar, with its own coordinates.
    if ns_window
        .styleMask()
        .contains(NSWindowStyleMask::FullScreen)
    {
        return;
    }
    let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    // SAFETY: plain getters; the buttons sit in the titlebar view, which sits in the container.
    let Some(container) = (unsafe { close.superview().and_then(|titlebar| titlebar.superview()) })
    else {
        return;
    };
    let button_height = close.frame().size.height;
    let container_height = button_height + inset_y;
    debug_assert!(
        fits(container_height, button_height),
        "trafficLightPosition y {inset_y} leaves the container too short for the buttons on the band's centre line"
    );
    if !fits(container_height, button_height) {
        return;
    }
    // The container's frame is in the window's frame view, whose origin is the window's own.
    let window_height = ns_window.frame().size.height;
    let mut frame = container.frame();
    if (frame.size.height - container_height).abs() >= TOLERANCE
        || (frame.origin.y - (window_height - container_height)).abs() >= TOLERANCE
    {
        frame.size.height = container_height;
        frame.origin.y = window_height - container_height;
        container.setFrame(frame);
    }
    for which in BUTTONS {
        let Some(button) = ns_window.standardWindowButton(which) else {
            continue;
        };
        // SAFETY: a plain getter, as above.
        let Some(parent) = (unsafe { button.superview() }) else {
            continue;
        };
        let mut rect = button.convertRect_toView(button.bounds(), None);
        let y = button_bottom(window_height, rect.size.height);
        if (rect.origin.y - y).abs() >= TOLERANCE {
            rect.origin.y = y;
            let mut origin = button.frame().origin;
            origin.y = parent.convertRect_fromView(rect, None).origin.y;
            button.setFrameOrigin(origin);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 14 pt button on the 52 pt band's centre line has its bottom 33 pt below the top, which
    /// the container has to reach: 19 is the smallest inset.
    #[test]
    fn puts_a_buttons_centre_on_the_band_and_needs_a_container_that_reaches_its_bottom() {
        assert_eq!(button_bottom(620.0, 14.0), 587.0);
        assert!(fits(38.0, 14.0));
        assert!(fits(33.0, 14.0));
        assert!(!fits(32.0, 14.0));
    }

    /// The band's height is drawn in the frontend; the lights are centred on the same band.
    #[test]
    fn the_band_is_the_height_the_titlebar_draws() {
        let titlebar = include_str!("../../src/components/Titlebar.tsx");
        assert!(titlebar.contains(&format!("flex h-[{BAND_HEIGHT}px]")));
    }
}
