on run arguments
	-- tell application "Finder" to display dialog "hello"
	set theDocFilePath to first item of arguments -- the references database .bib file, or empty to create a new one
	set thePubFilePath to second item of arguments -- the new, temporary, single-reference .bib file
	set doOpenPub to (third item of arguments is equal to "true")
	set doBringToFront to (fourth item of arguments is equal to "true")
	set doAddbraces to (fifth item of arguments is equal to "true")
	set pdfPath to sixth item of arguments
	
	set readFile to open for access POSIX file thePubFilePath
	set pubData to read readFile as Çclass utf8È
	close access readFile
	
	if theDocFilePath is not equal to "" then set theDocFile to POSIX file theDocFilePath
	
	tell application "BibDesk"
		if theDocFilePath is equal to "" then
			set theDoc to make new document
		else
			open theDocFile
			set theDoc to get first document
		end if
		tell theDoc
			set newPub to make new publication at the end of publications
			tell newPub

				-- import BibTeX
				set BibTeX string to pubData
				set cite key to generated cite key as string -- 'as string' is seemingly required under Tiger
				if doAddbraces then set title to "{" & title & "}"

				-- delete file and note fields from Zotero and add DOI to linked URLs
				set value of field "file" to ""
				set value of field "note" to ""
				if value of field "doi" is not equal to ""
				   add "http://dx.doi.org/" & (value of field "doi") to end of linked URLs
				end if

				-- link PDF
				if pdfPath is not equal to "" then
				   set autofilePDF to false
				   set cleanPDF to ""
				   set delPageOne to ""

				   set optList to {"Autofile", "Do nothing"}
				   activate
				   choose from list optList with prompt "Do the following with article PDF" default items {"Autofile"}
				   if item 1 of result is "Autofile" then
				      set autofilePDF to true
				   end if

				   if autofilePDF then
				      add (POSIX file pdfPath) to beginning of linked files
				      auto file
				   end if
				end if
			end tell
			set selection to {newPub}
			if doOpenPub then show newPub -- pop up reference in own window
		end tell
		if doBringToFront then activate -- bring BibDesk to front
	end tell
end run
