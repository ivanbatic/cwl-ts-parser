#!/usr/bin/env node
let argv = require("yargs").argv;
let parser = require("../index");
let git = require("nodegit");
let rimraf = require("rimraf");

let outdir = argv._[0];


if (!outdir) {
    console.log("outdir is needed");
    process.exit(1);
}

let cwldir = "../../cwl.tmp";
rimraf(cwldir, _ => {
    console.log("Cloning the Common Workflow Language repository");
    git.Clone("https://github.com/common-workflow-language/common-workflow-language", cwldir)
        .finally(_ => {
            console.log("Generating Typescript Interfaces");
            parser.generate(cwldir, outdir);
            console.log("Cleaning up the repository");
            rimraf(cwldir, _ => null);
        });
});



