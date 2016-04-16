var config = require('./config');

var AWS = require('aws-sdk');
var async = require('async');
var prompt = require('prompt');
var colors = require('colors');
var CloudFlareAPI = require('cloudflare-api');

var cloudflare = new CloudFlareAPI(config.cloudflare);

AWS.config.update(config.ec2);

var ec2 = new AWS.EC2({
  apiVersion: '2015-10-01',
  region: 'ap-northeast-1'
});

var newIp = '';

async.waterfall([
  function(cb) {
    ec2.describeAddresses({}, function(err, data) {
      if (err) {
        cb(err);
      } else {
        if (data.Addresses.length > 0) {
          for (var i in data.Addresses) {
            var InstanceId = data.Addresses[i].InstanceId ? data.Addresses[i].InstanceId : '无';
            var index = parseInt(i) + 1;
            console.log(index + ". " + data.Addresses[i].PublicIp + "\t已关联实例：" + InstanceId);
          }
          cb(null, data.Addresses);
        } else {
          console.log('没有找到已分配弹性 IP，开始分配新地址'.green)
          cb(null, null);
        }
      }
    });
  },
  function(ipDataList, cb) {
    if (!!ipDataList) {
      prompt.start();
      prompt.get(['IP Number'], function(err, result) {
        if (err) {
          cb(err)
        } else {
          var index = result['IP Number'] - 1;
          cb(null, ipDataList[index]);
        }
      });
    } else {
      cb(null, null);
    }
  },
  function(ipData, cb) {
    if (ipData && ipData.AssociationId) {
      var params = {
        AssociationId: ipData.AssociationId
      };
      ec2.disassociateAddress(params, function(err, data) {
        if (err) {
          cb(err)
        } else {
          console.log("已取消关联".green);
          cb(null, ipData);
        }
      });
    } else {
      console.log("无需取消关联".green);
      cb(null, ipData);
    }
  },
  function(ipData, cb) {
    if (ipData && ipData.AllocationId) {
      var params = {
        AllocationId: ipData.AllocationId
      };
      ec2.releaseAddress(params, function(err, data) {
        if (err) {
          cb(err)
        } else {
          console.log("弹性 IP 已释放".green);
          cb(null);
        }
      });
    } else {
      console.log("无需释放".green);
      cb(null);
    }
  },
  function(cb) {
    var params = {
      Domain: 'vpc'
    };
    ec2.allocateAddress(params, function(err, data) {
      if (err) {
        cb(err)
      } else {
        console.log("分配新的弹性 IP：".green + data.PublicIp);
        newIp = data.PublicIp;
        cb(null, data);
      }
    });
  },
  function(ipData, cb) {
    ec2.describeInstances({}, function(err, data) {
      if (err) {
        cb(err)
      } else {
        var index = 0;
        var instanceList = [];
        for (var i in data.Reservations) {
          for (var j in data.Reservations[i].Instances) {
            index++;
            instanceList.push(data.Reservations[i].Instances[j]);
            console.log(index + '. ' + data.Reservations[i].Instances[j].InstanceId);
          }
        }
        cb(null, instanceList, ipData);
      }
    });
  },
  function(instanceList, ipData, cb) {
    if (!!instanceList.length) {
      prompt.start();
      prompt.get(['Instance Number'], function(err, result) {
        if (err) {
          cb(err)
        } else {
          var index = result['Instance Number'] - 1;
          cb(null, instanceList[index], ipData);
        }
      });
    } else {
      cb("无可用实例");
    }
  },
  function(instance, ipData, cb) {
    var params = {
      AllocationId: ipData.AllocationId,
      InstanceId: instance.InstanceId
    };
    ec2.associateAddress(params, function(err, data) {
      if (err) {
        cb(err)
      } else {
        console.log("绑定 IP 成功".green);
        cb(null);
      }
    });
  },
  function(cb) {
    cloudflare.execute({
      a: 'zone_load_multi'
    }).then(function(result) {
      var zones = result.response.zones.objs;
      for (var i in zones) {
        var index = parseInt(i) + 1;
        console.log(index + '. ' + zones[i].display_name);
      }
      cb(null, zones);
    }).catch(function(err) {
      cb(err);
    });
  },
  function(domainList, cb) {
    if (!!domainList.length) {
      prompt.start();
      prompt.get(['Domain Number'], function(err, result) {
        if (err) {
          cb(err)
        } else {
          var index = result['Domain Number'] - 1;
          cb(null, domainList[index]);
        }
      });
    } else {
      cb("无可用域名");
    }
  },
  function(domain, cb) {
    cloudflare.execute({
      a: 'rec_load_all',
      z: domain.zone_name,
    }).then(function(result) {
      var recs = result.response.recs.objs;
      for (var i in recs) {
        var index = parseInt(i) + 1;
        console.log(index + '. ' + recs[i].display_name);
      }
      cb(null, recs);
    }).catch(function(err) {
      cb(err);
    });
  },
  function(recList, cb) {
    if (!!recList.length) {
      prompt.start();
      prompt.get(['Record Number'], function(err, result) {
        if (err) {
          cb(err)
        } else {
          var index = result['Record Number'] - 1;
          cb(null, recList[index]);
        }
      });
    } else {
      cb("无可用记录");
    }
  },
  function(rec, cb) {
    cloudflare.execute({
      a: 'rec_edit',
      z: rec.zone_name,
      type: 'A',
      name: rec.name,
      id: rec.rec_id,
      content: newIp,
      ttl: 120
    }).then(function(result) {
      console.log("更新 DNS 记录成功".green);
      cb(null);
    }).catch(function(err) {
      cb(err);
    });
  }
], function(err, result) {
  if (err) {
    return console.log(err.toString().red);
  } else {
    console.log("更换 IP 成功".green);
  }
})
