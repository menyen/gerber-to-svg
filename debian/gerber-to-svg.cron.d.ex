#
# Regular cron jobs for the gerber-to-svg package
#
0 4	* * *	root	[ -x /usr/bin/gerber-to-svg_maintenance ] && /usr/bin/gerber-to-svg_maintenance
