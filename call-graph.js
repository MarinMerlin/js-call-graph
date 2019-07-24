const acorn = require("acorn");
const walk = require("acorn-walk");
const readdirp = require('readdirp');
const _ = require("lodash");
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2)
const directoryPath = path.join(args[0]);

var parsedFileList = [];
var results = [];
var settings = {
    // Filter files with js and json extension
    fileFilter: [ '*.js' ],
    // Filter by directory
    directoryFilter: ["!node_modules"]
};

var moduleFunctions = [
    {
	fullPath: 'waterline',
	name: 'waterline',
	functionList: ['find','findOne','update','destroy','create','sort']
    },
    {
	fullPath: 'http',
	name: 'http',
	functionList: ['send', 'on']
    },
    {
	fullPath: 'JSON',
	name: 'JSON',
	functionList: ['stringify']
    }
];

var objectArrayIncludes = function(array,name,property){
    var indexOfProp = null;
    _.forEach(array,(object,index)=>{
	if(object.hasOwnProperty(name)){
	    if(object[name] === property && !object.hasOwnProperty('exportFunction')){
		indexOfProp = index;
	    };
	};
    });
    return(indexOfProp);
};

var matchFunction = function(name,list){
    var matchList = [];
    _.forEach(list,(file)=>{
	_.forEach(file.functionList,(fnName)=>{
	    if(fnName === name){
		matchList.push({
		    file:file.fullPath,
		    name: name
		});
	    };
	});
    });
    return(matchList);
};

var getFnCallPath= function(node, path = []){
    if(node.type === 'Identifier'){
	path.push(node.name);
	return path;
    } else if (node.type === 'MemberExpression'){
	path.push(node.property.name);
	return getFnCallPath(node.object,path);
    } else {
	return null;
	//console.log('ERROR!!!!!!!');
    };
};

var getFnCallOrigin = function(ancestors){
    var i = 0;
    var result = null;
    while(i<ancestors.length){
	if(ancestors[i].type === 'FunctionExpression' && !ancestors[i].hasOwnProperty('exportFunction') && i>0){
	    var ancestor = ancestors[i-1];
	    switch(ancestor.type){
	    case "VariableDeclarator":
		result = ancestor.id.name;
		break;
	    case "Property":
		result = ancestor.key.name;
		break;
	    default:
		console.log("Not a handled function declaration (" + ancestor.type + ")");
	    };
	    i = ancestors.length;
	}
	i++;
    };
    return result;
};

var objectHasProperty = function(json,path){
    var exists = true;
    var currentObj = json;
    var i = 0;
    while(exists && i<path.length){
	if(!currentObj.hasOwnProperty(path[i])){
	    exists = false;
	}else{
	    currentObj = currentObj[path[i]];
	}
	i++;
    }
    return exists
};

var getImportedFn = function(name, parsedFile, parsedFilePath){
    var fnOriginPath = null;
    walk.simple(parsedFile,{
	VariableDeclarator(node){
	    if(node.id.name === name){
		walk.ancestor(node,{
		    Identifier(childNode,childAncestors){
			if(childNode.name === 'require'){
			    if(objectHasProperty(childAncestors,['1','arguments','0','value'])){
				fnOriginPath = path.join(path.dirname(parsedFilePath),childAncestors[1].arguments[0].value);
			    };
			};
		    }
		})
	    };
	}
    });
    return fnOriginPath;
};

var generateDotFile = function(clusterList,callList){
    var writer = fs.createWriteStream(args[1], {
	flags: 'a' // 'a' means appending (old data will be preserved)
    });
    writer.write('digraph {\n')
    writer.write('#Dotfile for the call graph of the ubismart platform\n');
    writer.write(`rankdir=LR
fontname="sans-serif"
node [shape=rectangle fillcolor=white style=filled fontname="sans-serif"]
graph [penwidth=0 style=rounded] # can't have bgcolor="#00000030" here because it would set the whole graph background as well
graph [nodesep=.1]
edge [minlen=3 fontname="sans-serif"]\n`);
    _.forEach(clusterList,(cluster)=>{
	if(!cluster.fullPath.includes('policies')){
	writer.write('subgraph cluster');
	writer.write(cluster.fullPath.replace(/\//g,'_').replace('.','_'));
	writer.write('{ label="'+cluster.fullPath+'" bgcolor="#00000030"\n')
	_.forEach(cluster.functionList,(fn)=>{
	    writer.write('"F '+ cluster.name + '_' + fn+'"\n');
	});
	writer.write('"F '+cluster.fullPath+'"\n')
	    writer.write('}\n')
	}
    });
    writer.write('\n\n\n');
    _.forEach(callList,(call)=>{
	var name = call.file.split('/')[call.file.split('/').length-1].slice(0,-3);
	if(call.fn.file.includes('.js')){
	    var name2 = call.fn.file.split('/')[call.fn.file.split('/').length-1].slice(0,-3);
	}else{var name2 = call.fn.file};
	if(call.origin){
	    writer.write('"F '+ name + '_' + call.origin+'"');
	}else{
	    writer.write('"F '+call.file+'"');
	};
	writer.write(' -> ');
	writer.write('"F '+ name2 + '_' + call.fn.name+'"\n')
    });
    writer.write('}')
};

readdirp(directoryPath,settings)
    .on('data',(entry)=>{

	//Filter out unwanted directories, the fiulter option on readdirp doesnt work
	if(!(entry.fullPath.includes('migrations') || entry.fullPath.includes('config') || entry.fullPath.includes('assets') || entry.fullPath.includes('tmp'))){
	    fs.readFile(entry.fullPath,'utf8',(err,data)=>{

		//The info for the clusters in our grap
		var fileInfo = {
		    fullPath: entry.fullPath,
		    name: entry.basename.slice(0,-3),
		    functionList: []
		};
		var parsedFile = acorn.parse(data,{sourceType:'module'});

		//First we check wether module.export is a function expression, if thats the case we want to ignore for the rest of the reasoning
		var exportsFunction = false;
		walk.simple(parsedFile,{
		    AssignmentExpression(node){
			if(node.hasOwnProperty('left') && node.hasOwnProperty('right')){
			    if(node.right.type === 'FunctionExpression' && node.left.hasOwnProperty('object') && node.left.hasOwnProperty('property')){
				if(node.left.object.name === 'module' && node.left.property.name === 'exports'){
				    node.right.exportFunction = true;
				    exportsFunction = true;
				};
			    };
			};
		    }
		});

		//We store all the parsed files and their path because we will go over them again once this pass is finished 
		parsedFileList.push([parsedFile,entry.fullPath]);

		//For now I have detected only two variants in the way functions are declared in the parsed file
		walk.ancestor(parsedFile,{
		    FunctionExpression(node,ancestors) {
			var cloneAncestors = [...ancestors];
			cloneAncestors.pop();
			if(!objectArrayIncludes(cloneAncestors,'type','FunctionExpression')){
			    var ancestor = ancestors[ancestors.length-2]
			    switch(ancestor.type){
			    case "VariableDeclarator":
				fileInfo.functionList.push(ancestor.id.name);
				break;
			    case "Property":
				fileInfo.functionList.push(ancestor.key.name);
				break;
			    default:

			    };
			};
		    }
		});

		//If no function is detected and the module.export is declared as a function then the file itself is the function name
		if(fileInfo.functionList.length === 0 && exportsFunction){
		    fileInfo.functionList.push(fileInfo.name);
		};
		
		if(fileInfo.functionList.length !==0){
		    results.push(fileInfo);
		};
	    });
	}
    })
    .on('warn', error => console.error('non-fatal error', error))
    .on('error', error => console.error('fatal error', error))
    .on('end', () => {

	//Generated a single list with all the functions
	var completeList = [];
	_.forEach(results,(file)=>{
	    completeList = completeList.concat(file.functionList);
	});

	//Optional code which checks how many functions have the same name
	var plop = {};
	_.forEach(completeList,(name)=>{
	    if(plop.hasOwnProperty(name)){
		plop[name] ++;
	    }else{
		plop[name] = 1;
	    }
	})
	var plip = {};
	_.forEach(plop,(value,key)=>{
	    if(plip.hasOwnProperty(value.toString())){
		plip[value.toString()] ++;
	    }else{
		plip[value.toString()] = 1;
	    }
	})
	
	var totalCount = 0;
	var treatedCount = 0;
	var callList = [];
	var unTreated = [];
	var callPathList = [];

	//We add to the functions found a list of functions defined by modules 
	results = results.concat(moduleFunctions);

	_.forEach(parsedFileList,(file)=>{
	    var parsedFile = file[0];
	    walk.ancestor(parsedFile,{
		CallExpression(node,ancestors){

		    //Returns the whole function call (eg kb.store.loadStoreToString(...)) or null if the CallExpression doesn't match the correct format
		    var callPath = getFnCallPath(node.callee);
		    if(callPath){
			
			//Returns a list of the functions that match the name [{file:/home/ubismart/... name: exampleFunction}]
			var matchs = matchFunction(callPath[0],results);
			var exactMatch = null;
			var callOrigin = null;

			//A filter to remove from the functions that ones that we know shouldn't be called (controllers are only called via routing and endpoints via external services)
			if(matchs.length>0){
			    matchs = _.filter(matchs,(match)=>{
				return (!match.file.includes('/controllers/') && !match.file.includes('EndPoint.js'))
			    });
			    totalCount++;

			    //We group together function calls that begin the same and assume that they reference the same file
			    var clonePath = [...callPath];
			    clonePath.shift();
			    clonePath = clonePath.join('.');

			    //Exclude the callPaths we know are not unique
			    if(clonePath === '' || clonePath === 'that' || clonePath === 'this'){
				callPathList.push({callPath: clonePath,functions:[{name:callPath[0],path:file[1], found:false}],file:null});
				indexOfProp = callPathList.length - 1;
			    } else {
				var indexOfProp = objectArrayIncludes(callPathList,'callPath',clonePath);

				//If it already exists, if there is a file registered for this callPath and if it matches one of the matches then assume it is the correct match
				if(indexOfProp){
				    callPathList[indexOfProp].functions.push({name:callPath[0],path:file[1],found: false});
				    if(callPathList[indexOfProp].file){
					var index = objectArrayIncludes(matchs,'file',callPathList[indexOfProp].file);
					if(index){

					    callPathList[indexOfProp].functions[callPathList[indexOfProp].functions.length -1].found = true;
					    exactMatch = matchs[index];
					    callOrigin = getFnCallOrigin(ancestors);
					    treatedCount ++;
					}
				    }
				//If it doesnt exist yet add it to the list with an unknown file
				} else {
				    callPathList.push({callPath: clonePath,functions:[{name:callPath[0],path:file[1], found:false}],file:null});
				    indexOfProp = callPathList.length - 1;
				};
			    };
			    
			    if(!exactMatch){

				//The case where only one function matches so it is rthe correct one (false assumption because it could be a function defined by a node module)
				if(matchs.length === 1){
				    treatedCount ++;
				    exactMatch = matchs[0];
				    callOrigin = getFnCallOrigin(ancestors);
				};
			    
				if(matchs.length > 1){
				    
				    //Check wether the function called comes from this file
				    if(callPath.length === 1 || callPath[callPath.length-1] === 'that' || callPath[callPath.length-1] === 'this'){
					_.forEach(matchs,(match)=>{
					    if(match.file === file[1]){
						treatedCount ++;
						exactMatch = match;
						callOrigin = getFnCallOrigin(ancestors);
					    };
					});
					
					//If the function is directly called (ex object.function(...)) check wether the object is defined by a require with a path to the original file
				    } else if(callPath.length === 2){
					_.forEach(matchs,(match)=>{
					    var importedFnPath = getImportedFn(callPath[1],parsedFile,file[1]);
					    if(importedFnPath === match.file){
						treatedCount ++;
						exactMatch = match;
						callOrigin = getFnCallOrigin(ancestors);
					    }
					})
					
				    };
				};
			    };
			    if(exactMatch){

				//If for the current callPath no file was associated then add it and for all other untreated functions of this callPath check again
				if(!callPathList[indexOfProp].file){
				    callPathList[indexOfProp].file = exactMatch.file;
				    _.forEach(callPathList[indexOfProp].functions,(fn)=>{
					if(fn.name !== exactMatch.name && !fn.found){
					    var newMatchs = matchFunction(fn.name,results);
					    var index = objectArrayIncludes(newMatchs,'file',fn.path);
					    if(index){
						fn.found = true;
						callList.push({
						    file: fn.path,
						    fn: newMatchs[index],
						    origin: null
						});
					    };
					};
				    });
				};
				
				callPathList[indexOfProp].functions[callPathList[indexOfProp].functions.length -1].found = true;
				callList.push({
				    file: file[1],
				    fn: exactMatch,
				    origin: callOrigin
				});
			    } else {
				unTreated.push({file: file[1], name: callPath});
			    };
			};
		    };
		}
	    });
	});
//	console.log(JSON.stringify(callPathList));
	console.log("Treated",callList.length,"out of a total",totalCount);
	generateDotFile(results,callList);
    });


