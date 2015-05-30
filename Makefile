# super modern builder / task runner Makefile

NAME := gerber-to-svg
EXPORT := gerberToSvg
ENTRY := src/gerber-to-svg.coffee
SRC_DIR := src
LIB_DIR := lib
DIST_DIR := dist
TEST_DIR := test

SRC := $(shell find $(SRC_DIR) -name '*.coffee')
LIB := $(patsubst $(SRC_DIR)/%.coffee, $(LIB_DIR)/%.js, $(SRC))
DIST := $(DIST_DIR)/$(NAME).js
DIST_MIN := $(DIST_DIR)/$(NAME).min.js
TEST := $(shell find $(TEST_DIR) -name '*_test.coffee')

UGLIFY_OPTS := --c --drop_console -m
BR_OPTS := -s $(EXPORT) -t coffeeify --extension=.coffee

all: lib dist

lib: $(LIB)

dist: $(DIST) $(DIST_MIN)

lint:
	coffeelint $(SRC) $(TEST_DIR)/*.coffee

test:
	mocha -R spec --recursive --compilers coffee:coffee-script/register \
    --require coffee-coverage/register-istanbul $(TEST_DIR) \
	&& istanbul report text-summary lcov

test-visual:
	coffee $(TEST_DIR)/visual-server.coffee

test-browsers:
	zuul --concurrency 2 $(TEST)

test-phantom:
	zuul --phantom $(TEST)

test-watch:
	chokidar $(SRC) $(TEST) -c 'make test'

watch:
	@mkdir -p $(DIST_DIR)
	chokidar $(SRC) -c "make lib" & \
	chokidar $(DIST) -c "make $(DIST_MIN)" & \
	watchify $(ENTRY) -v $(BR_OPTS) -o $(DIST)

clean:
	rm -rf $(LIB_DIR) $(DIST_DIR)

$(LIB_DIR)/%.js: $(SRC_DIR)/%.coffee
	coffee -o $(LIB_DIR) $<

$(DIST): $(SRC)
	@mkdir -p $(@D)
	browserify $(ENTRY) $(BR_OPTS) > $@

$(DIST_MIN): $(DIST)
	uglifyjs $< $(UGLIFY_OPTS) > $@

.PHONY: lint lib dist test test-visual test-browsers test-phantom test-watch watch clean
