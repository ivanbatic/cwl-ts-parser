#!/usr/bin/env node
let argv = require("yargs").argv;
let parser = require("../index");
let git = require("nodegit");

let outdir = argv._[0];


if (!outdir) {
    console.log("outdir is needed");
    process.exit(1);
}

let cwldir = "../../cwl.tmp";
git.Clone("https://github.com/common-workflow-language/common-workflow-language", cwldir)
    .finally(_ => parser.generate(cwldir, outdir));



