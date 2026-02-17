"""Tests for linux_display.py — screenshot, windows, apps, focus, launch."""

import subprocess
from unittest.mock import patch, MagicMock

import linux_display as display


def _mock_run(args, **kwargs):
    """Mock subprocess.run returning empty stdout."""
    class Result:
        stdout = ""
        returncode = 0
    return Result()


class TestScreenSize:
    @patch("subprocess.run")
    def test_xdpyinfo(self, mock_run):
        mock_run.return_value = MagicMock(
            stdout="  dimensions:    1920x1080 pixels"
        )
        w, h = display.screen_size()
        assert (w, h) == (1920, 1080)

    @patch("subprocess.run")
    def test_xrandr_fallback(self, mock_run):
        def side_effect(args, **kwargs):
            if args[0] == "xdpyinfo":
                raise FileNotFoundError("xdpyinfo not found")
            return MagicMock(
                stdout="HDMI-1 connected 2560x1440+0+0"
            )
        mock_run.side_effect = side_effect
        w, h = display.screen_size()
        assert (w, h) == (2560, 1440)

    @patch("subprocess.run")
    def test_default_fallback(self, mock_run):
        mock_run.side_effect = FileNotFoundError("not found")
        w, h = display.screen_size()
        assert (w, h) == (1920, 1080)


@patch("subprocess.run", side_effect=_mock_run)
class TestScreenshot:
    def test_basic_screenshot(self, mock_run):
        body, code = display.screenshot({})
        assert code == 200
        assert "path" in body
        assert body["path"] == "/tmp/claude-screenshot.png"

    def test_custom_path(self, mock_run):
        body, code = display.screenshot({"path": "/tmp/custom.png"})
        assert code == 200
        assert body["path"] == "/tmp/custom.png"

    def test_crop_region(self, mock_run):
        body, code = display.screenshot({"x": 10, "y": 20, "w": 100, "h": 50})
        assert code == 200
        assert body["crop"] == {"x": 10, "y": 20, "w": 100, "h": 50}
        # Should call scrot then convert for cropping
        calls = [c[0][0] for c in mock_run.call_args_list]
        assert any("scrot" in str(c) for c in calls)
        assert any("convert" in str(c) for c in calls)

    def test_indicator(self, mock_run):
        body, code = display.screenshot({"indicator_x": 50, "indicator_y": 75})
        assert code == 200
        calls = [c[0][0] for c in mock_run.call_args_list]
        assert any("convert" in str(c) for c in calls)


@patch("subprocess.run")
class TestWindows:
    def test_list_windows(self, mock_run):
        wmctrl_out = "0x01 0 1234 10 20 800 600 host Terminal\n"
        xdotool_out = "1"  # decimal of 0x01

        def side_effect(args, **kwargs):
            if args[0] == "wmctrl":
                return MagicMock(stdout=wmctrl_out)
            if args[0] == "xdotool":
                return MagicMock(stdout=xdotool_out)
            return MagicMock(stdout="")

        mock_run.side_effect = side_effect
        body, code = display.windows({})
        assert code == 200
        assert len(body["windows"]) == 1
        win = body["windows"][0]
        assert win["title"] == "Terminal"
        assert win["frame"]["x"] == 10
        assert win["focused"] is True

    def test_no_wmctrl(self, mock_run):
        mock_run.side_effect = FileNotFoundError("wmctrl not found")
        body, code = display.windows({})
        assert code == 200
        assert body["windows"] == []


@patch("subprocess.run")
class TestApps:
    def test_list_apps(self, mock_run):
        wmctrl_out = "0x01 0 1234 host Firefox\n0x02 0 5678 host Code\n"

        def side_effect(args, **kwargs):
            if args[0] == "wmctrl":
                return MagicMock(stdout=wmctrl_out)
            if args[0] == "ps":
                return MagicMock(stdout="firefox")
            return MagicMock(stdout="")

        mock_run.side_effect = side_effect
        body, code = display.apps({})
        assert code == 200
        assert len(body["apps"]) >= 1

    def test_no_wmctrl(self, mock_run):
        mock_run.side_effect = FileNotFoundError("wmctrl not found")
        body, code = display.apps({})
        assert code == 200
        assert body["apps"] == []


@patch("subprocess.run", side_effect=_mock_run)
class TestFocus:
    def test_missing_params(self, mock_run):
        body, code = display.focus({})
        assert code == 400

    def test_focus_by_window_id(self, mock_run):
        body, code = display.focus({"window_id": "0x01"})
        assert code == 200
        assert body["focused"] == "0x01"

    def test_app_not_found(self, mock_run):
        body, code = display.focus({"app": "nonexistent"})
        assert code == 404


class TestFocusByApp:
    @patch("subprocess.run")
    def test_focus_by_app_name(self, mock_run):
        mock_run.return_value = MagicMock(
            stdout="0x01 0 host Firefox\n"
        )
        body, code = display.focus({"app": "firefox"})
        assert code == 200
        assert body["focused"] == "firefox"


@patch("subprocess.Popen")
class TestLaunch:
    def test_missing_app(self, mock_popen):
        body, code = display.launch({})
        assert code == 400

    def test_launch_success(self, mock_popen):
        body, code = display.launch({"app": "firefox"})
        assert code == 200
        assert body["launched"] == "firefox"

    def test_launch_fallback(self, mock_popen):
        call_count = 0
        def side_effect(args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise FileNotFoundError()
            return MagicMock()
        mock_popen.side_effect = side_effect
        body, code = display.launch({"app": "Firefox"})
        assert code == 200
        # Should have tried "Firefox" first, then "firefox"
        assert body["launched"] == "firefox"

    def test_launch_not_found(self, mock_popen):
        mock_popen.side_effect = FileNotFoundError()
        body, code = display.launch({"app": "nonexistent"})
        assert code == 404
