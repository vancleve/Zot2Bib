on run arguments
	-- tell application "Finder" to display dialog "hello"
	set theDocFilePath to first item of arguments -- the references database .bib file, or empty to create a new one
	set thePubFilePath to second item of arguments -- the new, temporary, single-reference .bib file
	set doOpenPub to (third item of arguments is equal to "true")
	set doBringToFront to (fourth item of arguments is equal to "true")
	set doAddbraces to (fifth item of arguments is equal to "true")
	set pdfPath to sixth item of arguments

	set abbrevCMD to "/Users/vancleve/bin/abbreviateJournalTitles.pl"
	
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

				-- delete braces in author, journal, and title fields using the UNIX shell command 'tr'
				set value of field "author" to (do shell script "echo " & (value of field "author") & " | tr -d '{}'")
				set value of field "journal" to (do shell script "echo " & (value of field "journal") & " | tr -d '{}'")
				set value of field "title" to (do shell script "echo " & (value of field "title") & " | tr -d '{}'")

				-- delete file, note, and other fields from Zotero
				set value of field "file" to ""
				set value of field "note" to ""
				set value of field "urldate" to ""
				set value of field "copyright" to ""

				-- add DOI to linked URLs
				if value of field "doi" is not equal to ""
				   add "http://dx.doi.org/" & (value of field "doi") to end of linked URLs
				end if

				-- abbreviate journal name
				set command to (abbrevCMD & " -m " & "\"" & value of field "journal" as text) & "\""
				set newJournal to (do shell script command)
				if newJournal is not equal to "" then
				   set value of field "journal" to newJournal
				end if

				-- link PDF
				if pdfPath is not equal to "" then
				   set autofilePDF to false
				   set cleanPDF to ""
				   set delPageOne to ""

				   set optList to {"Autofile", "Autofile and delete first page of PDF", "Autofile, uncompress PDF, and delete first page", "Autofile and uncompress PDF", "Do nothing"}
				   activate
				   choose from list optList with prompt "Do the following with article PDF" default items {"Autofile"}
				   if item 1 of result is "Autofile" then
				      set autofilePDF to true
				   else if item 1 of result is "Autofile and delete first page of PDF"
				      set autofilePDF to true
				      set delPageOne to "2-end"				      
				   else if item 1 of result is "Autofile and uncompress PDF" then
				      set autofilePDF to true
				      set cleanPDF to "uncompress"
				   else if item 1 of result is "Autofile, uncompress PDF, and delete first page" then
				      set autofilePDF to true
				      set cleanPDF to "uncompress"
				      set delPageOne to "2-end"
				   end if

				   if (cleanPDF is not equal to "") or (delPageOne is not equal to "") then
				      set cleanPDFCMD to Â
				      "export PATH=/usr/local/bin:$PATH;Â
				      tempfoo=cleanPDFtmpfile;Â
				      TMPFILE=`mktemp /tmp/${tempfoo}.XXXXXX` || exit 1;Â
				      pdftk \""& pdfPath &"\" cat " & delPageOne & " output $TMPFILE " & cleanPDF & " 2>&1;Â
				      cp $TMPFILE \"" & pdfPath & "\";Â
				      rm $TMPFILE"
				      do shell script cleanPDFCMD
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
