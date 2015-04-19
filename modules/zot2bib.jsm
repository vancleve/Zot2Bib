var EXPORTED_SYMBOLS = ['Zot2Bib'];

var Zotero;
var own_path = Components.classes["@mackerron.com/getExtDir;1"].createInstance().wrappedJSObject.getExtDir();
var prefs   = Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefService).getBranch("extensions.z2b.");
var ffPrefs = Components.classes["@mozilla.org/preferences-service;1"].
    getService(Components.interfaces.nsIPrefService).getBranch("browser.download.");
var about_window_ref, prefs_window_ref, help_window_ref;

var deleteQueue = [];
var deleteCallback = {
  notify: function(t) {
    if (deleteQueue.length < 1) return;
    var itemId = deleteQueue.shift();
    if (itemId && Zotero.Items.get(itemId)) Zotero.Items.erase([itemId], true);
  }
}

var zoteroCallback = {
    notify: function(event, type, ids, extraData) {

	var items = Zotero.Items.get(ids);

	Zotero.debug('event: ' + event + ', type: ' + type + ', ids: ' + ids + ', items.length: ' + items.length);

	// zotero has added a reference. if it has a PDF attachement, then wait until its done.
	// otherwise, export to bibtex
	if (event == 'add') {	    
	    for (var i = 0; i < items.length; i ++) {
		var item = items[i];
		if (! item.isRegularItem() || 
		    ((item.numCreators() > 0 ? 1 : 0) 
		     + (item.getField('title') ? 1 : 0) 
		     + (item.getField('date') ? 1 : 0) < 2)) continue; // require at least two of: authors, title, date
								
		// var prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
		//     .getService(Components.interfaces.nsIPromptService);

		var children = item.getAttachments(false);
		// Zot2Bib.infoWindow("Zot2Bib test","num attachments: " + item.numAttachments(false), 8000);

		// prompts.alert(null, "Zot2Bib test", "ref ID : " + item.id);

		var waitingOnPDF = false;
		for each(var childID in children) {
		    var child = Zotero.Items.get(childID);
		    if (child.isAttachment()) {
			// If attachment is a PDF
			if (child.attachmentMIMEType == 'application/pdf') {
			    // tell PDF which ID is its parent
			    // item.setField('extra', item.id)
			    // item.save();
			    waitingOnPDF = true;
			}
			if (waitingOnPDF == false) {
			    Zot2Bib.saveBibTeX(item);
			}
			//prompts.alert(null, "Zot2Bib test", "attachmentmimetype : " + child.attachmentMIMEType);
			
		    }
		}		
	    }
	}

	// checking on PDF attachements to see if they're done and then exporting.
	else if (event == 'modify') {
	    var pdfpath = Zot2Bib.getPDFDir(true);
	    
	    for (var i = 0; i < items.length; i ++) {
		var item = items[i];
		// var prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"].
		//     getService(Components.interfaces.nsIPromptService);
		
		if (item.isAttachment()) {
		    var file = item.getFile();
		    // make sure file exists and is PDF
		    if (file && item.attachmentMIMEType == 'application/pdf') { //Zotero.File.getExtension(file) == "pdf") {
			// if attachment is attached to parent references that was imported
			var dir = Components.classes["@mozilla.org/file/local;1"].
			    createInstance(Components.interfaces.nsILocalFile);
			dir.initWithPath(pdfpath);
			// prompts.alert(null, "Zot2Bib test", "dir path: " + dir.path);
			file.copyTo(dir, file.leafName);
						
			// open PDF
			if (prefs.getBoolPref('openpdf')) {
			    var opencmd = Components.classes["@mozilla.org/file/local;1"].
				createInstance(Components.interfaces.nsILocalFile);
			    opencmd.initWithPath('/usr/bin/open');
			    var openprocess = Components.classes["@mozilla.org/process/util;1"].
				createInstance(Components.interfaces.nsIProcess);
			    openprocess.init(opencmd);
			    var args = [dir.path + "/" + file.leafName];
			    openprocess.runw(true, args, args.length)
			}

			// save bibtex item and link PDF
			var parentItem = Zotero.Items.get(item.getSource());
			Zot2Bib.saveBibTeX(parentItem, dir.path + "/" + file.leafName)
		    }
		}
	    }
	}

	// if PDF is deleted, recover the parent item ID and import that into bibtex
	else if (event == 'delete') {
	    item = extraData[ids[0]];
	    //Zotero.debug('extraData: ' + extraData[ids[0]].old.sourceItemKey);
	    
	    if (item.old.attachment.mimeType == 'application/pdf') {
		var sql = "SELECT itemID FROM items WHERE key='" + item.old.sourceItemKey +"'";
		var parent_id = Zotero.DB.valueQuery(sql);
		Zotero.debug('sql id: ' + parent_id);

	    	var parentItem = Zotero.Items.get(parent_id);
	    	Zot2Bib.saveBibTeX(parentItem);
	    }
	}
    }
}


Zot2Bib = {
    initOnce: function(z) {
	if (! Zotero) {
	    Zotero = z;
	    Zotero.Notifier.registerObserver(zoteroCallback, ['item']);
	}
    },
    about: function(w) {
	if (! about_window_ref || about_window_ref.closed) about_window_ref = w.open("chrome://zot2bib/content/about.xul", "", "centerscreen,chrome,dialog");
	else about_window_ref.focus();
    },
    preferences: function(w) {
	if (! prefs_window_ref || prefs_window_ref.closed) prefs_window_ref = w.open("chrome://zot2bib/content/preferences.xul", "", "centerscreen,chrome,dialog,resizable");
	else prefs_window_ref.focus();
    },
    help: function(w) {
	if (! help_window_ref || help_window_ref.closed) help_window_ref = w.open("chrome://zot2bib/content/help.html");
	else help_window_ref.focus();
    },
    populateMenu: function(menu) {
	
	var doc = menu.ownerDocument;
	var menuitemtype = prefs.getBoolPref('manydests') ? 'checkbox' : 'radio';
	var destfiles = Zot2Bib.loadList('destfiles');
	var bibfiles = Zot2Bib.loadList('bibfiles');

	var addMenuItem = function(props, attrs) {
	    var item = doc.createElement('menuitem');
	    for (prop in props) { if (! props.hasOwnProperty(prop)) continue; item[prop] = props[prop]; }
	    for (attr in attrs) { if (! attrs.hasOwnProperty(attr)) continue; item.setAttribute(attr, attrs[attr]); }
	    menu.appendChild(item);
	}
	while (menu.firstChild) menu.removeChild(menu.firstChild);

	addMenuItem({}, {label: 'Add new publications to...', disabled: 'true'});

	var attrs;

	attrs = {label: 'Zotero', type: menuitemtype, name: 'z2b-destination', tooltiptext: 'Add to Zotero, as if this extension was not installed'}
	if (prefs.getBoolPref('keepinzotero')) attrs.checked = 'true';
	addMenuItem({id: 'z2b-add-zotero'}, attrs);

	attrs = {label: 'New BibTeX files', type: menuitemtype, name: 'z2b-destination', tooltiptext: 'Create a new file in BibDesk for each publication'};
	if (prefs.getBoolPref('addtoempty')) attrs.checked = 'true';
	addMenuItem({id: 'z2b-add-empty'}, attrs);

	for (var i = 0; i < bibfiles.length; i ++) {
	    var bibfile = bibfiles[i];
	    attrs = {label: bibfile.substr(bibfile.lastIndexOf('/') + 1), type: menuitemtype, name: 'z2b-destination', crop: 'center', tooltiptext: bibfile, value: bibfile};
	    for (var j = 0; j < destfiles.length; j ++) if (bibfile == destfiles[j]) attrs.checked = 'true';
	    addMenuItem({id: 'z2b-bibfile-' + i}, attrs);
	}

	menu.appendChild(doc.createElement('menuseparator'));
	addMenuItem({}, {label: 'About Zot2Bib', oncommand: 'Zot2Bib.about(window);'});
	addMenuItem({}, {label: 'Preferences...', oncommand: 'Zot2Bib.preferences(window);'});
	addMenuItem({}, {label: 'Help', oncommand: 'Zot2Bib.help(window);'});
    },
    saveMenuChoices: function(m) {
	Zotero.log('saveMenuChoices');
	var a = [];
	for (var i = 0; i < m.childNodes.length; i ++) {
	    var mi = m.childNodes[i];
	    if (mi.id == 'z2b-add-zotero') {
		prefs.setBoolPref('keepinzotero', mi.hasAttribute('checked'));
		Zotero.log('keepinzotero ' + prefs.getBoolPref('keepinzotero'));
	    }
	    else if (mi.id == 'z2b-add-empty') {
		prefs.setBoolPref('addtoempty', mi.hasAttribute('checked'));
		Zotero.log('addtoempty ' + prefs.getBoolPref('addtoempty'));
	    }
	    else if (mi.id.match(/^z2b-bibfile-[0-9]+$/) && mi.hasAttribute('checked')) a.push(mi.getAttribute('value'));
	}
	Zot2Bib.saveList('destfiles', a);
    },
    numDests: function() {
	return Zot2Bib.loadList('destfiles').length + (prefs.getBoolPref('keepinzotero') ? 1 : 0) + (prefs.getBoolPref('addtoempty') ? 1 : 0);
    },
    removeDestFile: function(f) {
	var fs = Zot2Bib.loadList('destfiles');
	for (var i = fs.length - 1; i >= 0 ; i --) if (fs[i] == f) {
	    fs.splice(i, 1);
	    Zot2Bib.saveList('destfiles', fs);
	}
    },
    saveList: function(pref, a) {
	var b = [];
	for (var i = 0; i < a.length; i ++) b[i] = escape(a[i]);
	prefs.setCharPref(pref, b.join(','));
    },
    loadList: function(pref) {
	var s = prefs.getCharPref(pref);
	if (s.length == 0) return []; // weirdly, splitting an empty string appears to produce an Array with one empty string element, not an empty Array
	else {
	    var a = s.split(',');
	    for (var i = 0; i < a.length; i ++) a[i] = unescape(a[i]);
	    return a;
	}
    },
    infoWindow: function(main, message, time){
        var pw = new (Zotero.ProgressWindow);
        pw.changeHeadline(main);
        if (main=="error") pw.changeHeadline(Zotero.getString("general.errorHasOccurred"));  pw.addDescription(message);
        pw.show();
        pw.startCloseTimer(time);
	
    },
    // fileExists: test if file exists
    fileExists: function (path) {
	var file = Components.classes["@mozilla.org/file/local;1"].
	    createInstance(Components.interfaces.nsILocalFile);
	file.initWithPath(path);

	try {
            return(file.exists());
        }
        catch (err) {
            return(false);
        }
    },
    // getFFDownloadFolder: obtain the download folder from Firefox
    // -- borrowed from ZotFile by Joscha Legewie
    getFFDownloadFolder: function () {
        var path="";
        try {
            if(ffPrefs.getBoolPref('useDownloadDir')) {
                var downloadManager = Components.classes["@mozilla.org/download-manager;1"]
                    .getService(Components.interfaces.nsIDownloadManager);
                path=downloadManager.userDownloadsDirectory.path;
            }
            if(!ffPrefs.getBoolPref('useDownloadDir') 
	       && ffPrefs.prefHasUserValue('lastDir') ) {
                path=ffPrefs.getCharPref('lastDir');
            }
        }
        catch (err) {
            path="";
        }
        return(path);
    },
    // getPDFDir: get the current direction to save PDFs in before autofiling in BibDesk
    // -- inspired by "getSourceDir" in ZotFile by Joscha Legewie
    getPDFDir: function(message) {
        var pdfdir="";
                        
        if ( prefs.getBoolPref("pdfdiruseff")) 
	    pdfdir=Zot2Bib.getFFDownloadFolder();
        if (!prefs.getBoolPref("pdfdiruseff"))
	    pdfdir=prefs.getCharPref("pdfdir");
                                   
        // test whether valid source dir
        if (pdfdir!="" && Zot2Bib.fileExists(pdfdir)) {
            return (pdfdir);
        } else {
            if(message)
		Zot2Bib.infoWindow("Zot2Bib error",
				   "Invalid PDF download directory",8000);
            return(-1);
        }
    },
    // chooseDirectory: open brower window to choose a directory
    chooseDirectory: function () {
        var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
            .getService(Components.interfaces.nsIWindowMediator);
        var win = wm.getMostRecentWindow('navigator:browser');
	
        var ps = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
            .getService(Components.interfaces.nsIPromptService);
	
        var nsIFilePicker = Components.interfaces.nsIFilePicker;
        while (true) {
            var fp = Components.classes["@mozilla.org/filepicker;1"]
                .createInstance(nsIFilePicker);
            fp.init(win, Zotero.getString('dataDir.selectDir'), nsIFilePicker.modeGetFolder);
            fp.appendFilters(nsIFilePicker.filterAll);
            if (fp.show() == nsIFilePicker.returnOK) {
                var file = fp.file;
		
                // Set preference	
		prefs.setCharPref('pdfdir', file.persistentDescriptor);
		prefs.setBoolPref('pdfdiruseff', false);

                return(file.path);
            }
            else {
                return(false);
            }
        }
    },
    saveBibTeX: function(item, pdf) {
	var file = Components.classes["@mozilla.org/file/directory_service;1"].
	    getService(Components.interfaces.nsIProperties).get("TmpD", Components.interfaces.nsIFile);
	file.append("zotero_item_" + item.id + ".bib");
	file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0666);
	
	var script_path = own_path.path + '/zot2bib.applescript';
	var osascript = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
	osascript.initWithPath('/usr/bin/osascript');
	var process = Components.classes["@mozilla.org/process/util;1"].createInstance(Components.interfaces.nsIProcess);
	process.init(osascript);
	
	var destfiles = Zot2Bib.loadList('destfiles');
	if (prefs.getBoolPref('addtoempty')) destfiles.push('');
	var openpub = prefs.getBoolPref('openpub') ? 'true' : 'false';
	var bringtofront = prefs.getBoolPref('bringtofront') ? 'true' : 'false';
	var extrabraces = prefs.getBoolPref('extrabraces') ? 'true' : 'false';
	
	var translator = new Zotero.Translate('export');
	translator.setTranslator('9cb70025-a888-4a29-a210-93ec52da40d4'); // BibTeX
	translator.setItems([item]);
	translator.setLocation(file);
	
	translator.setHandler('done', function() {
	    if (Zot2Bib.numDests() < 1) {
		var prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"].
		    getService(Components.interfaces.nsIPromptService);
		prompts.alert(null, 
			      "No destination for new publications is selected in Zot2Bib",
			      "Use the Zot2Bib status bar menu to select a destination, then try again.");
	    }
	    for (var j = 0; j < destfiles.length; j ++) {
		if (!pdf) {
		    pdfPath = "";
		}
		else {
		    pdfPath = pdf
		}
		var args = [script_path, destfiles[j], file.path, openpub, bringtofront, extrabraces, pdfPath];
		process.runw(false, args, args.length); 
		// first param true => calling thread will be blocked until called process terminates
	    }
	    if (! prefs.getBoolPref('keepinzotero')) {
		deleteQueue.push(item.id);
		
		// This seems like the right way to do this, but doesn't work!!
		// var timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
		// timer.initWithCallback(deleteCallback, 1000, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
		
		// This is messy, but seems to work
		var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"].
		    getService(Components.interfaces.nsIWindowMediator);
		wm.getMostRecentWindow("navigator:browser").setTimeout(deleteCallback.notify, 5000);
	    }
	});
	
	translator.translate();
    }
}
