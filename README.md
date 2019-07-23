# js-call-graph
Script which goes through a directory and outputs a dot file graphing all the function definitions in the project and all the calls to these functions

## Install

  - Have node installed globably on your machine. If thats not the case follow instructions [here](https://nodejs.org/en/download/)
  - Have npm installed, for help click [here](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
  - Clone this repository
  - Run `cd js-call-graph`  
  - Run `npm install`
Thats it!

## Command and parameters

To execute the script run `node js-call-graph.js "relative/path/to/the/directory" "path/to/output/file.dot"`

To render the graph with dot i recommend [xdot](https://pypi.org/project/xdot/)
