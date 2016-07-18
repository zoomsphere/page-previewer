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
        options.uri = options.uri || options.url;
    } else {
        options.uri = urlObj;
    }

    url = options.uri;

    var req = request(options, function (err, response, body) {
        var uri = req.uri;
        var host = req.host;
        var preview;

        if (!err && response.statusCode === 200 && body) {
            var decodedBody = decodeBody(response, body);
            var doc = cheerio.load(decodedBody);

            var redirectUrl = getNaverLazyFrameURL(uri, doc);
            if (redirectUrl) {
                options.originalUri = options.uri;
                options.uri = redirectUrl;
                getPreview(options, callback);
            } else {
                preview = parseDocument(doc, url);
                if (options.originalUri) {
                    preview.url = options.originalUri;
                }
                preview.host = host;
                callback(null, preview);
            }

        } else {
            callback(null, createResponseData(url, true));
        }
    });

    req.on("response", function (res) {
        var host = req.host;
        var contentType = res.headers["content-type"];
        if (contentType && contentType.indexOf("text/html") !== 0) {
            req.abort();
            var preview = parseMediaResponse(contentType, url);
            if (options.originalUri) {
                preview.url = options.originalUri;
            }
            preview.host = host;
            callback(null, preview);
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
        charset = charset.toLowerCase();
        if (charset.match(/ms(\d+)/g)) {
            charset = charset.replace('ms', 'windows');
        }
        try {
            return iconv.decode(bodyBuffer, charset);
        } catch (exception) {
            return bodyBuffer.toString('utf8');
        }
    } else {
        return bodyBuffer.toString('utf8');
    }
}

function getNaverLazyFrameURL(uri, doc) {
    var path = doc("frame[id='mainFrame']").attr("src");
    if (path) {
        if (path.indexOf('http') == 0) {
            return path;
        }
        return urlObj.resolve(uri.protocol + '//' + uri.host, path);
    }
    return null;
}

function parseDocument(doc, url) {
    var title,
        description,
        keywords,
        mediaType,
        images,
        videos,
        audios;

    title = getTitle(doc);

    description = getDescription(doc);

    keywords = getKeywords(doc);

    mediaType = getMediaType(doc);

    images = getImages(doc, url);

    videos = getVideos(doc);

    audios = getAudios(doc);

    return createResponseData(url, false, title, description, keywords, "text/html", mediaType, images, videos, audios);
}

function getTitle(doc) {
    var title = doc("meta[property='og:title']").attr("content");

    if (!title) {
        title = doc("meta[property='title']").attr("content");

        if (!title) {
            title = doc("title").text();
        }
    }

    return title;
}

function getDescription(doc) {
    var description = doc("meta[property='og:description']").attr("content");

    if (description === undefined) {
        description = doc("meta[name=description]").attr("content");

        if (description === undefined) {
            description = doc("meta[name=Description]").attr("content");
        }
    }

    return description;
}

function getMediaType(doc) {
    var type = doc("meta[property='og:type']").attr("content");
    if (type === undefined) {
        type = doc("meta[name=medium]").attr("content");
    }
    return type == "image" ? "photo" : type;
}

function getImages(doc, pageUrl) {
    var images = [], nodes, src,
        width, height,
        dic;

    nodes = doc("meta[property='og:image']");

    if (nodes.length) {
        nodes.each(function (index, node) {
            src = node.attribs["content"];
            if (src) {
                src = urlObj.resolve(pageUrl, src);
                images.push(src);
            }
        });
    }

    var minImageSize = 500;
    var maxImageSize = 1080;
    if (images.length <= 0) {
        nodes = doc("img");
        if (nodes.length) {
            dic = {};
            var tempArray = [];
            nodes.each(function (index, node) {
                src = node.attribs["src"];
                if (src && !dic[src]) {
                    dic[src] = 1;
                    width = node.attribs["width"] || minImageSize;
                    height = node.attribs["height"] || minImageSize;
                    src = urlObj.resolve(pageUrl, src);
                    if (width >= minImageSize && height >= minImageSize &&
                        width < maxImageSize && height < maxImageSize && !isAdUrl(src)) {
                        var size = width * height;
                        tempArray.push({ size: size, image: src });
                    }
                }
            });
            tempArray.sort(function (a, b) {
                return b.size - a.size;
            });
            for (var i in tempArray) {
                if (tempArray[i].image) images.push(tempArray[i].image);
            }
        }
    }

    return images;
}

function isAdUrl(url) {
    if (url) {
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
    length = nodes.length;
    if (length) {
        videos = [];
        nodeTypes = doc("meta[property='og:video:type']");
        nodeSecureUrls = doc("meta[property='og:video:secure_url']");
        width = doc("meta[property='og:video:width']").attr("content");
        height = doc("meta[property='og:video:height']").attr("content");

        for (index = 0; index < length; index++) {
            video = nodes[index].attribs["content"];

            nodeType = nodeTypes[index];
            videoType = nodeType ? nodeType.attribs["content"] : null;

            nodeSecureUrl = nodeSecureUrls[index];
            videoSecureUrl = nodeSecureUrl ? nodeSecureUrl.attribs["content"] : null;

            videoObj = { url: video, secureUrl: videoSecureUrl, type: videoType, width: width, height: height };
            if (videoType.indexOf("video/") === 0) {
                videos.splice(0, 0, videoObj);
            } else {
                videos.push(videoObj);
            }
        }
    }

    return videos;
}


function getAudios(doc) {
    var audios;

    var nodes = doc("meta[property='og:audio']");
    var length = nodes.length;
    if (length) {
        audios = [];

        for (var index = 0; index < length; index++) {
            audios.push(nodes[index].attribs["content"]);
        }
    }

    return audios;
}

function getKeywords(doc) {
    var keywords;
    var keywordsString = doc("meta[name='og:keywords']").attr("content");

    if (!keywordsString) {
        keywordsString = doc("meta[name='keywords']").attr("content");
    }
    if (keywordsString) {
        keywords = keywordsString.split(',');
    } else {
        keywords = [];
    }

    return keywords;
}

function parseMediaResponse(contentType, url) {
    if (contentType.indexOf("image/") === 0) {
        return createResponseData(url, false, "", "", [], contentType, "photo", [url]);
    } else {
        return createResponseData(url, false, "", "", [], contentType);
    }
}

function createResponseData(url, loadFailed, title, description, keywords, contentType, mediaType, images, videos, audios) {
    return {
        url: url,
        loadFailed: loadFailed,
        title: title,
        description: description,
        keywords: keywords,
        contentType: contentType,
        mediaType: mediaType || "website",
        images: images,
        videos: videos,
        audios: audios
    };
}

module.exports = getPreview;
