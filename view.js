/******************************************************************************
* view.js                                                                     *
* Copyright 2012                                                              *
* For details about the copyright holders, see the COPYRIGHT file.            *
* This software is freely distributed under the ISC License.                  *
* For details about the license, see the LICENSE file.                        *
******************************************************************************/
(function() {
	var comments_div,
	highlight_start = -1,
	highlight_end = -1,
	selection_start = -1,
	selection_end = -1,
	comment_ob = null,
	comment_box_ob = null,
	num_lines = -1,
	comments = {},
	language_data = null,
	codeMirror = null,
	diffMirror = null,
	mergeMirror = null,
	noSelect = false,
	codeOptions = null,
	diffOptions = null,
	commentOptions = null,
	commentMirrors = [],
	diffComputer = new diff_match_patch(),
	appliedDiffs = [];

/******************************************************************************
* Utility Functions                                                           *
******************************************************************************/

	function modulo(n,m) {
		while(n < 0)
			n += m;
		return n%m;
	}

	function logError(text) {
		console.log('ERROR: ' + text);
	}

	function reportError(text) {
		logError(text);
		$('#error').text(text).show();
	}

	function handleAjaxError(jqXHR, textStatus, errorThrown) {
		reportError(errorThrown);
	}

	function include(filename) {
		if(filename.indexOf('.js') != -1) {
			$('<script>').attr('src',filename).appendTo($('head'));
		} else if(filename.indexOf('.css') != -1) {
			$('<link>')
				.attr('rel','stylesheet')
				.attr('href',filename)
				.appendTo($('head'));
		} else {
			logError('failed to include file: '+filename);
		}
	}

	function resolveRequirements(languages,language,requirements,req_list){
		var lang = languages[language];
		var requires = lang.requires;
		if(requires){
			for(var requirement in requires){
				var name = requires[requirement];
				if(!requirements[name]){
					requirements[name] = true;
					resolveRequirements(languages,name,requirements,req_list);
					req_list.push(name);
				}
			}
		}
	}

	// taken from
	// http://www.quirksmode.org/js/cookies.html
	function createCookie(name,value,days) {
		var expires = "";
		if (days) {
			var date = new Date();
			date.setTime(date.getTime()+(days*24*60*60*1000));
			var expires = "; expires="+date.toGMTString();
		}
		document.cookie = name+"="+value+expires+"; path=/";
	}

	// taken from
	// http://www.quirksmode.org/js/cookies.html
	function readCookie(name) {
		var nameEQ = name + "=";
		var ca = document.cookie.split(';');
		for(var i=0;i < ca.length;i++) {
			var c = ca[i];
			while (c.charAt(0)==' ') c = c.substring(1,c.length);
			if (c.indexOf(nameEQ) == 0)
				return c.substring(nameEQ.length,c.length);
		}
		return null;
	}

/******************************************************************************
* Data retrieval                                                              *
******************************************************************************/

	function getCode(id,success_fn,error_fn) {
		$.ajax('do/code',{
			data:	 {id:id},
			dataType: 'json',
			error:	error_fn,
			success:  success_fn
		});
	}

	function getComments(id,success_fn,error_fn) {
		$.ajax('do/comments',{
			data:	 {code_id:id},
			dataType: 'json',
			error:	error_fn,
			success:  success_fn
		});
	}

	function getLanguage(id,success_fn,error_fn) {
		$.ajax('do/language',{
			data:	 {id:id},
			dataType: 'json',
			error:	error_fn,
			success:  success_fn
		});
	}

	function getLanguageData(success_fn,error_fn) {
		$.ajax('languages.json',{
			dataType: 'json',
			error:	error_fn,
			success:  success_fn
		});
	}

/******************************************************************************
* Highlighting                                                                *
******************************************************************************/

	function getSelection(codeMirror){
		if(!noSelect){
			if(codeMirror.somethingSelected){
				var start = codeMirror.getCursor(true).line + 1;
				var end = codeMirror.getCursor(false).line + 1;
				hideComments();
				showCommentBox(start,end);
			}else{
				hideCommentBox();
			}
		}
	}

	function setSelection(event){
		var startLine = event.data.startLine-1;
		var endLine = event.data.endLine;
		noSelect = true;
		codeMirror.setSelection({line:startLine,ch:0},{line:endLine,ch:0});
		noSelect = false;
	}

/******************************************************************************
* Comment Input                                                               *
******************************************************************************/

	function showCommentBox(start,end) {
		selection_start = start;
		selection_end = end;
		$('input#line_start').val(start);
		$('input#line_end').val(end);
		$('#lineStartNum').text(start);
		$('#lineEndNum').text(end);
		diffMirror.setOption("firstLineNumber",start);
		diffMirror.setValue(codeMirror.getRange(
			{line:start-1,ch:0},
			{line:end-1,ch:999999}));
		var comment_box = $('#comment_box');
		var coords = codeMirror.charCoords({line:start-1,char:0});
		comment_box.css('top',coords.y);
		comment_box.slideDown();
	}

	function closeCommentBox() {
		$('#comment_box').hide();
		selection_start = -1;
		selection_end = -1;
	}

/******************************************************************************
* Comment Display                                                             *
******************************************************************************/

	function writeComments(comments_ob) {
		if((typeof comments_ob) === "string"){
			comments_ob = jQuery.parseJSON(comments_ob);
		}
		buildCommentStructure(comments_ob);
		codeMirror.refresh();
	}

	function buildCommentStructure(comments_ob) {
		var comments_list = comments_ob.comments;
		for(var index in comments_list) {
			var comment = comments_list[index];
			var line_start = comment.line_start;
			if(comments[line_start] === undefined)
				comments[line_start] = [];
			comments[line_start].push(comment);
		}
		for(var i in comments){
			buildCommentSet(Number(i)-1,comments[i]);
		}
	}

	function buildCommentSet(lineNumber,commentSet) {
		if(codeMirror == null) {
			logError('Tried to build comment set while code mirror null');
			return;
		}
		commentMirrors[lineNumber] = [];
		codeMirror.setMarker(lineNumber,
							 "<span class='commentNumber'>("+
							 commentSet.length+")</span> %N%");
		var set = $("<div class='commentSet'>");
		var coords = codeMirror.charCoords({line:lineNumber,char:0});
		//console.log('coords');
		//console.dir(coords);
		set.css('top',coords.y);
		set.attr("lineNumber",lineNumber);
		for(var i=0;i<commentSet.length;i++){
			var comment = commentSet[i];
			var commentDiv = $("<div class='commentBox'>");
			commentDiv.mouseover({startLine:comment.line_start,endLine:comment.line_end},setSelection);
			var title = $("<div class='commentTitle'>");
			title.text(comment.user);
			var body = $("<div class='commentBody'>");
			body.text(comment.text);
			
			commentDiv.append(title);
			commentDiv.append(body);
			
			set.append(commentDiv);
			
			if(comment.diffs){
				var diffs = $("<textarea class='commentDiffs'>");
				var from = {line:comment.line_start-1,ch:0};
				var to = {line:comment.line_end-1,ch:999999};
				var original = codeMirror.getRange(from,to);
				console.log(diffComputer);
				var rawDiffs = diffComputer.diff_main(original,comment.diffs);
				diffComputer.diff_cleanupSemantic(rawDiffs);
				rawDiffs.from = from;
				rawDiffs.to = to;
				var str = "";
				var hasDiffs = false;
				for(var index = 0; index<rawDiffs.length; index++){
					var diff = rawDiffs[index];
					str+=diff[1];
					hasDiffs = hasDiffs || diff[0];
				}
				if(hasDiffs){
					commentDiv.append(diffs);
					diffs.text(str);
				
					var mirror = CodeMirror.fromTextArea(
						diffs.get(0),commentOptions);
				
					var curIndex = 0;
					var curPos = mirror.posFromIndex(curIndex);
					console.log(rawDiffs);
					for(var index = 0; index<rawDiffs.length; index++){
						var diff = rawDiffs[index];
						var type = diff[0];
						var text = diff[1];
						console.log(text);
						var newIndex = curIndex+text.length;
						var newPos = mirror.posFromIndex(newIndex);
						mirror.markText(curPos,newPos,"diffStyle_"+type);
						curIndex = newIndex;
						curPos = newPos;
					}
					
					mirror.setOption("firstLineNumber",lineNumber+1);
					commentMirrors[lineNumber].push(mirror);
					var useIt = $("<input type='checkbox'>");
					useIt.click(function(){
						if($(this).is(":checked")){
							appliedDiffs.push(rawDiffs);	
						}else{
							appliedDiffs.splice(
								appliedDiffs.indexOf(rawDiffs),1);
						}
					})
					commentDiv.append($("<label>Use this diff</label>"));
					commentDiv.append(useIt);
				}
			}
			
		}

		$("#commentsDiv").append(set);
		set.hide();
	}

	function showComments(codeMirror, lineNumber){
		closeCommentBox();
		hideComments();
		$(".commentSet[lineNumber='"+lineNumber+"']").slideDown();
		var mirrors = commentMirrors[lineNumber];
		for(var index in mirrors){
			mirrors[index].refresh();
		}
	}

	function hideComments(){
		$(".commentSet").hide();
	}
	
	function merge(){
		if(!mergeMirror){
			var area = $("<textarea>");
			$("#codeDiv").append(area);
			mergeMirror = CodeMirror.fromTextArea(area.get(0),codeOptions);
		}
		mergeMirror.setValue(codeMirror.getValue());
		
		for(var i in appliedDiffs){
			var diffSet = appliedDiffs[i];
			var result = "";
			for(var j=0; j<diffSet.length; j++){
				var diff = diffSet[j];
				var type = diff[0];
				var text = diff[1];
				if(type!=-1){
					result+=text;
				}
			}
			mergeMirror.replaceRange(result,diffSet.from,diffSet.to);
		}
		mergeMirror.refresh();
	}

/******************************************************************************
* Code Display                                                                *
******************************************************************************/

	function writeCodeLines(code) {
		if(code === null) return;
		if((typeof code) === "string"){
			code = jQuery.parseJSON(code);
		}
		$('#code_id').val(code.id);
		var lines = code.text.split('\n');
		num_lines = lines.length;
		$("#code").text(code.text);
		if(!codeMirror){
			getLanguage(code.language_id,function(language_ob) {
				var language = language_data.data[language_ob.mode];
				var req_ob = {};
				var requirements = [];
				resolveRequirements(language_data.data,
									language_ob.mode,
									req_ob,
									requirements);
				if(req_ob[language_ob.mode] === undefined)
					requirements.push(language_ob.mode);
				for(var index in requirements) {
					var lang = requirements[index];
					var file = language_data.data[lang].file;
					if(file !== undefined) {
						include(language_data.include_path+file);
					}
				}
				
				//codeOptions, diffOptions, commentOptions are globals
				codeOptions = {
					lineNumbers: true,
					lineWrapping: true,
					fixedGutter: true,
					readOnly: true,
					mode: language.mode,
					onGutterClick: showComments,
					onCursorActivity: getSelection,
				};
				diffOptions = {
					lineNumbers: true,
					lineWrapping: true,
					fixedGutter: true,
					readOnly: false,
					smartIndent:false,
					mode: language.mode,
				};
				commentOptions = {
					lineNumbers: true,
					lineWrapping: true,
					fixedGutter: true,
					readOnly: true,
					mode: language.mode,
				};
				
				for(var index in language.options) {
					diffOptions[index] = 
						codeOptions[index] = 
						commentOptions[index] = language.options[index];
				}
				
				codeMirror = CodeMirror.fromTextArea(
					document.getElementById("code"),codeOptions);
				diffMirror = CodeMirror.fromTextArea(
					document.getElementById("diffs"),diffOptions);
				
				getComments(code.id,writeComments,handleAjaxError);
			},handleAjaxError);
		}else{
			comments = [];
			$(".commentSet").remove();
			getComments(code.id,writeComments,handleAjaxError);
		}
	}

/******************************************************************************
* Run when display ready                                                      *
******************************************************************************/

	$(document).ready(function() {
		var userName = readCookie('username');
		if(userName !== null) {
			$('#user').val(userName);
		}
		$('#user').change(function() {
			createCookie('username',$('#user').val());
		});
		$('#comment_box').hide();
		$('#error').hide();
		// retrieve and display code
		var query = URI(document.URL).query(true);
		if(query.error != undefined) {
			reportError(query.error);
		}
		if(query.id === undefined) {
			reportError("Code ID not found");
			return;
		}
		$('#comment_form').ajaxForm({
			beforeSerialize: function() {
				diffMirror.save();
			},
			success:function(){
				getCode(query.id,writeCodeLines,handleAjaxError);
				$('#text').val('');
				closeCommentBox();
			},
			error:handleAjaxError
		});
		$('#codeDiv').append(
			$('<button type="button">Merge Diffs</input>').click(merge));
		getLanguageData(function(language_ob) {
			language_data = language_ob;
			getCode(query.id,writeCodeLines,handleAjaxError);
		},handleAjaxError);
	});
})();
