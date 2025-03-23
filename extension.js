'use strict';

const { St, Clutter, GObject, GLib } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Util = imports.misc.util;
const Gio = imports.gi.Gio;

// Brightness Control Extension
const BrightnessControl = GObject.registerClass(
    class BrightnessControl extends PanelMenu.Button {

        _init() {
            super._init(0.5, "Screen Brightness Control");

            // Add icon
            this.icon = new St.Icon({
                icon_name: 'display-brightness-symbolic',
                style_class: 'system-status-icon',
            });
            this.add_child(this.icon);

            // Store display list and current selected display
            this._displays = [];
            this._currentDisplay = null;
            this._brightness = 50; // Default brightness value

            // Create menu items
            this._buildMenu();

            // Get display list
            this._getDisplays();
        }

        _buildMenu() {
            // Display selector dropdown menu
            this._displaySelector = new PopupMenu.PopupSubMenuMenuItem("Select Display");
            this.menu.addMenuItem(this._displaySelector);

            // Separator
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Add brightness slider
            const brightnessMenuItem = new PopupMenu.PopupBaseMenuItem({
                activate: false,
                reactive: false
            });

            const brightnessLabel = new St.Label({
                text: 'Brightness:',
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER
            });

            this._brightnessSlider = new Slider.Slider(this._brightness / 100);

            // Monitor slider changes
            this._brightnessSlider.connect('notify::value', this._onBrightnessChanged.bind(this));

            brightnessMenuItem.add_child(brightnessLabel);
            brightnessMenuItem.add_child(this._brightnessSlider);

            this.menu.addMenuItem(brightnessMenuItem);

            // Add refresh button
            const refreshButton = new PopupMenu.PopupMenuItem("Refresh Display List");
            refreshButton.connect('activate', () => {
                this._getDisplays();
            });
            this.menu.addMenuItem(refreshButton);
        }

        // Get connected display list
        _getDisplays() {
            try {
                // Clear existing display sub-menu
                this._displaySelector.menu.removeAll();
                this._displays = [];

                // Execute ddcutil command to get display list
                this._execCommand(['ddcutil', 'detect'], (stdout) => {
                    // Parse output to get display information
                    const lines = stdout.split('\n');
                    let currentBus = null;
                    let currentDisplay = {};

                    for (const line of lines) {
                        // Find I2C bus information
                        if (line.includes('I2C bus:')) {
                            const match = line.match(/I2C bus:\s+\/dev\/i2c-(\d+)/);
                            if (match) {
                                if (currentBus !== null && Object.keys(currentDisplay).length > 0) {
                                    this._displays.push(currentDisplay);
                                }
                                currentBus = match[1];
                                currentDisplay = { bus: currentBus, name: 'Display ' + currentBus };
                            }
                        }
                        // Try to extract more display information - add more matching methods
                        else if (currentBus !== null) {
                            if (line.includes('Monitor:') || line.includes('Model:') ||
                                line.includes('Display:') || line.includes('Description:')) {
                                const parts = line.split(':');
                                if (parts.length > 1 && parts[1].trim() !== '') {
                                    currentDisplay.name = parts[1].trim();
                                }
                            }
                            // Handle invalid display flag
                            if (line.includes('Invalid display')) {
                                currentDisplay.invalid = true;
                            }
                        }
                    }

                    // Add the last display
                    if (currentBus !== null && Object.keys(currentDisplay).length > 0 && !currentDisplay.invalid) {
                        this._displays.push(currentDisplay);
                    }

                    // Add menu items for each display
                    for (const display of this._displays) {
                        const item = new PopupMenu.PopupMenuItem(display.name);
                        item.connect('activate', () => {
                            this._currentDisplay = display;
                            this._displaySelector.label.text = display.name;

                            // 不再读取当前亮度，直接使用默认值
                            this._brightnessSlider.value = this._brightness / 100;
                        });
                        this._displaySelector.menu.addMenuItem(item);
                    }

                    // Default select the first display
                    if (this._displays.length > 0) {
                        this._currentDisplay = this._displays[0];
                        this._displaySelector.label.text = this._currentDisplay.name;

                        // 不再读取当前亮度，使用默认值
                        this._brightnessSlider.value = this._brightness / 100;
                    } else {
                        this._displaySelector.label.text = "No displays detected";
                    }
                });
            } catch (e) {
                log(`Error getting display list: ${e}`);
            }
        }

        // Brightness slider change callback
        _onBrightnessChanged() {
            if (!this._currentDisplay) return;

            // 直接使用滑块值（0-100）
            this._brightness = Math.round(this._brightnessSlider.value * 100);

            // 直接设置亮度，不延迟
            this._setBrightness(this._currentDisplay.bus, this._brightness);
        }

        // Set brightness
        _setBrightness(bus, value) {
            try {
                // 直接执行设置亮度命令
                this._execCommand(['ddcutil', 'setvcp', '10', value.toString(), '--bus', bus], (stdout) => {
                    log(`Brightness set to ${value}`);
                });
            } catch (e) {
                log(`Error setting brightness: ${e}`);
            }
        }

        // Helper function to execute commands - improved version
        _execCommand(args, callback) {
            try {
                log(`Executing command: ${args.join(' ')}`);

                // Use GLib.spawn_async_with_pipes for asynchronous execution and output capture
                let [success, pid, stdin_fd, stdout_fd, stderr_fd] =
                    GLib.spawn_async_with_pipes(
                        null, // Working directory
                        args, // Command arguments array
                        null, // Environment variables
                        GLib.SpawnFlags.SEARCH_PATH, // Flags
                        null // Child process setup function
                    );

                // Read data from standard output
                let stdout_stream = new Gio.UnixInputStream({ fd: stdout_fd, close_fd: true });
                let stdout_reader = new Gio.DataInputStream({ base_stream: stdout_stream });

                // Read data from standard error
                let stderr_stream = new Gio.UnixInputStream({ fd: stderr_fd, close_fd: true });
                let stderr_reader = new Gio.DataInputStream({ base_stream: stderr_stream });

                let stdout_lines = [];
                let stderr_lines = [];

                // Set up asynchronous reading
                this._readOutputAsync(stdout_reader, stdout_lines, () => {
                    this._readOutputAsync(stderr_reader, stderr_lines, () => {
                        if (stderr_lines.length > 0) {
                            log(`Command error output: ${stderr_lines.join('\n')}`);
                        }
                        callback(stdout_lines.join('\n'));

                        // Clean up readers and streams
                        stdout_reader.close(null);
                        stdout_stream.close(null);
                        stderr_reader.close(null);
                        stderr_stream.close(null);
                    });
                });

            } catch (e) {
                log(`Error executing command: ${e}`);
                callback("");
            }
        }

        // Asynchronously read command output
        _readOutputAsync(reader, lines, callback) {
            reader.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
                try {
                    const [line, length] = source.read_line_finish_utf8(res);

                    if (line !== null) {
                        lines.push(line);
                        this._readOutputAsync(reader, lines, callback);
                    } else {
                        callback();
                    }
                } catch (e) {
                    log(`Error reading command output: ${e}`);
                    callback();
                }
            });
        }
    });

// GNOME extension standard entry
class Extension {
    constructor() {
        this._indicator = null;
    }

    enable() {
        this._indicator = new BrightnessControl();
        Main.panel.addToStatusArea('brightness-control', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

function init() {
    return new Extension();
} 