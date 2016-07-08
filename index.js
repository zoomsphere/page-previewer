var request = require("request"),
	adblock = require("./lib/adblock.js"),
	urlObj = require("url"),
	cheerio = require("cheerio"),
    iconv = require('iconv-lite');


function getPreview(urlObj, callback) {

    var url;
    var options = {
        timeout: 10000,
        encoding: null,
	};

    if (typeof(urlObj) === "object") {
        options = Object.assign(options, urlObj);
    } else {
        options.uri = urlObj;
    }

    url = options.uri;

	var req = request(options, function(err, response, body) {
		if(!err && response.statusCode === 200 && body) {
			var decodedBody = decodeBody(response, body);
            callback(null, parseResponse(response, decodedBody, url));
		} else {
            var host = res.request.uri["host"];
			callback(null, createResponseData(url, host, true));
		}
	} );

	req.on("response", function(res) {
		var contentType = res.headers["content-type"];
		if(contentType && contentType.indexOf("text/html") !== 0) {
			req.abort();
			callback(null, parseMediaResponse(res, contentType, url) );
		}
	});
}

function getCharset(response, bodyBuffer) {
    var contentTypeHeader = response.headers["content-type"];

    var doc = cheerio.load(bodyBuffer.toString());
    var contentTypeMeta = doc("meta[http-equiv='Content-Type']").attr("content");

    var contentType = "";
    if (contentTypeMeta) {
        contentType = contentTypeMeta;
    } else if (contentTypeHeader) {
        contentType = contentTypeHeader;
    }

    var regex = /charset=([^"']+)/;
    var match = contentType.match(regex);

    if (match && match.length > 0) {
        var charset = match[1];
        return charset;
    } else {
        return null;
    }
}

function decodeBody(response, bodyBuffer) {
    var charset = getCharset(response, bodyBuffer);

    if (charset) {
        try {
            var decodedBody = iconv.decode(bodyBuffer, charset);
            return decodedBody;
        } catch (exception) {
            return bodyBuffer.toString('utf8');
        }
    } else {
        return bodyBuffer.toString('utf8');
    }
}

function parseResponse(res, body, url) {
	var doc,
        host,
		title,
		description,
		mediaType,
		images,
		videos;

    host = res.request.uri["host"];

    doc = cheerio.load(body);

    title = getTitle(doc);

	description = getDescription(doc);

	mediaType = getMediaType(doc);

	images = getImages(doc, url);

	videos = getVideos(doc);

	return createResponseData(url, host, false, title, description, "text/html", mediaType, images, videos);
}

function getTitle(doc){
    var title = doc("meta[property='og:title']").attr("content");

    if (title === undefined || !title) {
        title = doc("title").text();
    }

    return title;
}

function getDescription(doc){
    var description = doc("meta[property='og:description']").attr("content");

    if(description === undefined) {
        description = doc("meta[name=description]").attr("content");

        if(description === undefined) {
            description = doc("meta[name=Description]").attr("content");
        }
    }

    return description;
}

function getMediaType(doc) {
    var type = doc("meta[property='og:type']").attr("content");
	if(type === undefined) {
        type = doc("meta[name=medium]").attr("content");
	}
    return type == "image" ? "photo" : type;
}

var minImageSize = 50;
function getImages(doc, pageUrl) {
	var images = [], nodes, src,
		width, height,
		dic;

	nodes = doc("meta[property='og:image']");

	if(nodes.length) {
		nodes.each(function(index, node){
            src = node.attribs["content"];
            if(src){
                src = urlObj.resolve(pageUrl, src);
                images.push(src);
            }
		});
	}

	if(images.length <= 0) {
		src = doc("link[rel=image_src]").attr("href");
		if(src) {
            src = urlObj.resolve(pageUrl, src);
            images = [ src ];
		} else {
			nodes = doc("img");

			if(nodes.length) {
				dic = {};
				images = [];
				nodes.each(function(index, node) {
					src = node.attribs["src"];
					if(src && !dic[src]) {
						dic[src] = 1;
						width = node.attribs["width"] || minImageSize;
						height = node.attribs["height"] || minImageSize;
						src = urlObj.resolve(pageUrl, src);
						if(width >= minImageSize && height >= minImageSize && !isAdUrl(src)) {
							images.push(src);
						}
					}
				});
			}
		}
	}
	return images;
}

function isAdUrl(url) {
	if(url) {
		return adblock.isAdUrl(url);
	} else {
		return false;
	}
}

function getVideos(doc) {
	var videos,
		nodes, nodeTypes, nodeSecureUrls,
		nodeType, nodeSecureUrl,
		video, videoType, videoSecureUrl,
		width, height,
		videoObj, index, length;

	nodes = doc("meta[property='og:video']");
	length =  nodes.length;
	if(length) {
		videos = [];
		nodeTypes = doc("meta[property='og:video:type']");
		nodeSecureUrls = doc("meta[property='og:video:secure_url']");
		width = doc("meta[property='og:video:width']").attr("content");
		height = doc("meta[property='og:video:height']").attr("content");

		for(index = 0; index < length; index++) {
			video = nodes[index].attribs["content"];

			nodeType = nodeTypes[index];
			videoType = nodeType ? nodeType.attribs["content"] : null;

			nodeSecureUrl = nodeSecureUrls[index];
			videoSecureUrl = nodeSecureUrl ? nodeSecureUrl.attribs["content"] : null;

			videoObj = { url: video, secureUrl: videoSecureUrl, type: videoType, width: width, height: height };
			if(videoType.indexOf("video/") === 0) {
				videos.splice(0, 0, videoObj);
			} else {
				videos.push(videoObj);
			}
		}
	}

	return videos;
}

function parseMediaResponse(res, contentType, url) {
    var host = res.request.uri["host"];
	if(contentType.indexOf("image/") === 0) {
		return createResponseData(url, host, false, "", "", contentType, "photo", [url]);
	} else {
		return createResponseData(url, host, false, "", "", contentType);
	}
}

function createResponseData(url, host, loadFailed, title, description, contentType, mediaType, images, videos, audios) {
	return {
		url: url,
        host: host,
		loadFailed: loadFailed,
		title: title,
		description: description,
		contentType: contentType,
		mediaType: mediaType || "website",
		images: images,
		videos: videos,
		audios: audios
	};
}

module.exports = getPreview;
