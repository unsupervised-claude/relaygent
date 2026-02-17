"""Tests for linux_input.py — click, type, scroll, drag via xdotool."""

import subprocess
from unittest.mock import patch, call

import linux_input as inp


def _mock_run(args, **kwargs):
    """Mock subprocess.run that returns empty stdout."""
    class Result:
        stdout = ""
        returncode = 0
    return Result()


@patch("subprocess.run", side_effect=_mock_run)
class TestClick:
    def test_basic_click(self, mock_run):
        body, code = inp.click({"x": 100, "y": 200})
        assert code == 200
        assert body["clicked"]["x"] == 100
        assert body["clicked"]["y"] == 200
        # Should call mousemove then click
        calls = mock_run.call_args_list
        assert calls[0][0][0] == ["xdotool", "mousemove", "--sync", "100", "200"]
        assert calls[1][0][0] == ["xdotool", "click", "1"]

    def test_right_click(self, mock_run):
        body, code = inp.click({"x": 50, "y": 50, "right": True})
        assert code == 200
        calls = mock_run.call_args_list
        assert ["xdotool", "click", "3"] in [c[0][0] for c in calls]

    def test_double_click(self, mock_run):
        body, code = inp.click({"x": 50, "y": 50, "double": True})
        assert code == 200
        calls = mock_run.call_args_list
        assert any("--repeat" in c[0][0] for c in calls)

    def test_missing_coords(self, mock_run):
        body, code = inp.click({})
        assert code == 400
        assert "error" in body

    def test_missing_y(self, mock_run):
        body, code = inp.click({"x": 10})
        assert code == 400

    def test_with_modifiers(self, mock_run):
        body, code = inp.click({"x": 10, "y": 20, "modifiers": ["cmd", "shift"]})
        assert code == 200
        calls = [c[0][0] for c in mock_run.call_args_list]
        assert ["xdotool", "keydown", "ctrl"] in calls  # cmd -> ctrl
        assert ["xdotool", "keydown", "shift"] in calls
        assert ["xdotool", "keyup", "shift"] in calls
        assert ["xdotool", "keyup", "ctrl"] in calls


@patch("subprocess.run", side_effect=_mock_run)
class TestTypeInput:
    def test_type_text(self, mock_run):
        body, code = inp.type_input({"text": "hello"})
        assert code == 200
        assert body["typed"] == 5
        calls = mock_run.call_args_list
        assert "hello" in calls[0][0][0]

    def test_type_key(self, mock_run):
        body, code = inp.type_input({"key": "return"})
        assert code == 200
        assert body["key"] == "return"
        calls = mock_run.call_args_list
        assert "Return" in calls[0][0][0]

    def test_type_key_with_modifiers(self, mock_run):
        body, code = inp.type_input({"key": "a", "modifiers": ["cmd"]})
        assert code == 200
        calls = mock_run.call_args_list
        assert any("ctrl+a" in str(c) for c in calls)

    def test_missing_input(self, mock_run):
        body, code = inp.type_input({})
        assert code == 400

    def test_key_mapping(self, mock_run):
        for key, expected in [("tab", "Tab"), ("escape", "Escape"),
                              ("delete", "BackSpace"), ("up", "Up")]:
            mock_run.reset_mock()
            body, code = inp.type_input({"key": key})
            assert code == 200
            assert expected in str(mock_run.call_args_list)


@patch("subprocess.run", side_effect=_mock_run)
class TestScroll:
    def test_scroll_down(self, mock_run):
        body, code = inp.scroll({"amount": 3})
        assert code == 200
        assert body["scrolled"] == 3
        # button 5 = scroll down
        calls = mock_run.call_args_list
        assert "5" in calls[0][0][0]

    def test_scroll_up(self, mock_run):
        body, code = inp.scroll({"amount": -3})
        assert code == 200
        # button 4 = scroll up
        calls = mock_run.call_args_list
        assert "4" in calls[0][0][0]

    def test_scroll_at_position(self, mock_run):
        body, code = inp.scroll({"amount": 1, "x": 100, "y": 200})
        assert code == 200
        calls = mock_run.call_args_list
        assert calls[0][0][0] == ["xdotool", "mousemove", "--sync", "100", "200"]

    def test_default_amount(self, mock_run):
        body, code = inp.scroll({})
        assert code == 200
        assert body["scrolled"] == -3  # default


@patch("subprocess.run", side_effect=_mock_run)
class TestDrag:
    def test_basic_drag(self, mock_run):
        body, code = inp.drag({"startX": 10, "startY": 20, "endX": 100, "endY": 200})
        assert code == 200
        assert body["dragged"]["from"] == {"x": 10, "y": 20}
        assert body["dragged"]["to"] == {"x": 100, "y": 200}

    def test_missing_coords(self, mock_run):
        body, code = inp.drag({"startX": 10})
        assert code == 400

    def test_drag_calls_mousedown_mouseup(self, mock_run):
        inp.drag({"startX": 0, "startY": 0, "endX": 100, "endY": 100, "steps": 2})
        calls = [c[0][0] for c in mock_run.call_args_list]
        assert ["xdotool", "mousedown", "1"] in calls
        assert ["xdotool", "mouseup", "1"] in calls


@patch("subprocess.run", side_effect=_mock_run)
class TestTypeFromFile:
    def test_missing_path(self, mock_run):
        body, code = inp.type_from_file({})
        assert code == 400

    def test_file_not_found(self, mock_run):
        body, code = inp.type_from_file({"path": "/nonexistent/file.txt"})
        assert code == 404

    @patch("builtins.open", create=True)
    def test_type_from_file(self, mock_open, mock_run):
        from unittest.mock import mock_open as mo
        m = mo(read_data="typed content")
        with patch("builtins.open", m):
            body, code = inp.type_from_file({"path": "/tmp/test.txt"})
        assert code == 200
        assert body["typed"] == len("typed content")


class TestModFlags:
    def test_empty(self):
        assert inp._mod_flags(None) == []
        assert inp._mod_flags([]) == []

    def test_mapping(self):
        assert inp._mod_flags(["cmd"]) == ["ctrl"]
        assert inp._mod_flags(["alt"]) == ["alt"]
        assert inp._mod_flags(["cmd", "shift"]) == ["ctrl", "shift"]

    def test_unknown_modifier(self):
        assert inp._mod_flags(["super"]) == ["super"]
