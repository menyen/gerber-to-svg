DESTDIR =
MFDIR = $(DESTDIR)/var/mfab
MODPATH = $(MFDIR)/node_modules/gerber-to-svg

all:
	npm install
	gulp build

install:
	if [ ! -f $(MODPATH) ]; then mkdir -p $(MODPATH); fi
	tar cpf - .npmignore bin dist lib node_modules package.json | ( cd $(MODPATH) && tar xpvf - )

package:
	fakeroot debian/rules binary

clean:
	rm -rf lib node_modules
	git checkout dist/gerber-to-svg.js
	git checkout dist/gerber-to-svg.min.js
	fakeroot debian/rules clean
