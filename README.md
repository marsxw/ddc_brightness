# GNOME Extension for External Display Brightness Control

### Installation
    sudo apt-get install ddcutil
    sudo usermod -aG i2c $USER
    sudo groupadd --system i2c
    sudo cp /usr/share/ddcutil/data/45-ddcutil-i2c.rules /etc/udev/rules.d
    sudo /bin/sh -c 'echo i2c-dev >> /etc/modules-load.d/i2c-dev.conf'

### If modified, needs repackaging
    zip -r brightness-control@88huoxingwen.gmail.com.zip metadata.json extension.js stylesheet.css

### Installing the extension
    gnome-extensions install --force brightness-control@88huoxingwen.gmail.com.zip
    gnome-extensions enable brightness-control@88huoxingwen.gmail.com