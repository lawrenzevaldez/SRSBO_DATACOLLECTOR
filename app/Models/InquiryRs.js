"use strict";

/** @type {typeof import('@adonisjs/lucid/src/Lucid/Model')} */
const Model = use("Model");
const Db = use("Database");
const Env = use("Env");
const internalIp = use("internal-ip");
const leftPad = use("left-pad");
const trim = use("trim");
const Helpers = use("Helpers");
const br_code = Env.get("BRANCH_CODE", "");
const _ = use("lodash");
const CustomException = use("App/Exceptions/CustomException");

const moment = use("moment");
const TO_DATE = Env.get("TO_DATE");

class InquiryRs extends Model {
  constructor() {
    super();
    this.Today = moment().format("YYYY-MM-DD");
    // this.TodayTime = moment().format('YYYY-MM-DD HH:mm:ss');
    this.TodayTime = moment().format("YYYY/MM/DD");
  }

  async fetch_list_supplier() {
    let row = await Db.connection("srspos")
      .select("vendorcode", "description")
      .from("vendor")
      .whereNotNull("description");
    return row;
  }

  async getListRequest(
    dateFrom,
    dateTo,
    supplierCode,
    status,
    rsId,
    rs_action,
    brCode
  ) {
    let continue_ = "",
      where = [];
    try {
      if (dateFrom != "" && dateTo != "") {
        let from_ = new Date(dateFrom);
        let to_ = new Date(dateTo);

        continue_ += `rs_date >= ? AND rs_date <= ?`;
        where.push(from_);
        where.push(to_);
      }

      if (dateFrom == "" && dateTo == "") {
        continue_ += `rs_date >= ? AND rs_date <= ?`;
        where.push(this.Today);
        where.push(this.Today);
      }

      if (
        supplierCode != undefined &&
        typeof supplierCode != "undefined" &&
        supplierCode != "undefined" &&
        supplierCode != ""
      ) {
        continue_ += ` AND supplier_code = ?`;
        where.push(supplierCode);
      }

      if (rsId != "") {
        continue_ = ` (rs_id = ? OR movement_no = ?)`;
        where = [rsId, rsId];
      }

      if (status != 3 && status != undefined) {
        continue_ += ` AND approved = ?`;
        where.push(status);
      }

      let [row, field] = await Db.raw(
        `SELECT * FROM 0_rms_header WHERE processed != 0 AND rs_action = ${rs_action} AND ${continue_} ORDER BY rs_id`,
        where
      );
      return row.length == 0 ? [] : row;
    } catch (Exception) {
      console.log(Exception);
    }
  }

  async saveAuditTrail(tlogin_id, tdescription) {
    const trx = await Db.beginTransaction();
    try {
      let tip_address = await internalIp.v4();
      let tdate_start = moment().format("YYYY-MM-DD HH:mm:ss");

      let data = {
        tlogin_id: tlogin_id,
        tdescription: tdescription,
        tdate_start: tdate_start,
        tip_address: tip_address,
      };

      await Db.insert(data).into("0_audit_trail_return");
      await trx.commit();
      return true;
    } catch (Exception) {
      await trx.rollback();
      console.log(Exception);
      return false;
    }
  }

  async getExtended(rs_id, branchCode) {
    let items = await Db.select("qty", "price")
      .from("0_rms_items")
      .where("rs_id", rs_id);

    if (!items || items.length === 0) {
      return 0;
    }

    let total = 0;
    for (const row of items) {
      total += parseFloat(row.price) * parseFloat(row.qty);
    }
    return total.toFixed(3);
  }

  async updateRmsHeader(
    deliveryName,
    plateNumber,
    rs_id,
    /*file,*/ currentUser,
    rs_action
  ) {
    const trx = await Db.beginTransaction();
    try {
      if (rs_action == 2) {
        let datas = {
          movement_type: "FDFB",
          bo_processed_date: moment().format(TO_DATE),
          processed: "1",
          processed_by: "2",
          pending: "1",
        };

        let res = await trx
          .table("0_rms_header")
          .whereIn("rs_id", [rs_id])
          .update(datas);

        if (res) {
          let res = await trx
            .table("0_rms_items")
            .whereIn("rs_id", [rs_id])
            .update("pending", 1);
        }
      } else {
        let row = await Db.select("trs_id")
          .from("0_pickup_item")
          .where("trs_id", rs_id);
        if (row.length > 0) {
          return true;
        } else {
          try {
            // let fileName = `2~${rs_id}.${file.extname}`
            let datas = {
              trs_id: rs_id,
              tname: deliveryName,
              tplate_no: plateNumber,
              // timage: fileName,
            };
            let row = await trx.insert(datas).into("0_pickup_item");
            console.log(row);
            if (row) {
              let row = await trx
                .table("0_rms_header")
                .andWhere("rs_action", rs_action)
                .whereIn("rs_id", [rs_id])
                .update({ picked_up: 1 }, { expired_date: "" });
              if (row) {
                await trx.commit();
                return true;
              }
            }
          } catch (Exception) {
            console.log(Exception);
          }
          // if(row) {
          //     let row = await trx.table('0_rms_header')
          //                     .andWhere('rs_action', rs_action)
          //                     .whereIn('rs_id', [rs_id])
          //                     .update({picked_up: 1}, {expired_date: 1})
          //     if(row) {
          //         await file.move(Helpers.publicPath('images/uploads'), {
          //             name: fileName,
          //             overwrite: true
          //         })

          //         if(file.moved()) {
          //             await trx.commit()
          //             return true
          //         } else {
          //             return file.error()
          //         }
          //     }
          // }
        }
      }
    } catch (Exception) {
      await trx.rollback();
      console.log(Exception);
    }
  }

  async getTImage(rs_id) {
    let row = await Db.select("timage", "tname", "tplate_no")
      .from("0_pickup_item")
      .where("trs_id", rs_id);
    return row.length == 0 ? 0 : row[0];
  }

  async getHeaderRms(rs_id, brCode = "") {
    if (brCode == "") {
      let row = await Db.select("*").from("0_rms_header").where("rs_id", rs_id);
      return row.length == 0 ? [] : row[0];
    }

    let row = await Db.select("*").from("0_rms_header").where("rs_id", rs_id);
    return row.length == 0 ? [] : row[0];
  }

  async getDetailsRms(rs_id) {
    let row = await Db.select("*")
      .from("0_rms_items")
      .where("rs_id", rs_id)
      .orderBy("id", "desc");
    return row.length == 0 ? [] : row;
  }

  async getSupplierName(supp_code = "", brCode = "") {
    if (brCode == "") {
      let row = await Db.connection("srspos")
        .select("description")
        .from("vendor")
        .where("vendorcode", supp_code);
      return row.length == 0 ? "" : row[0].description;
    }
    let row = await Db.connection("srspos")
      .select("description")
      .from("vendor")
      .where("vendorcode", supp_code);
    return row.length == 0 ? "" : row[0].description;
  }

  async getRsIds(mtype, mno) {
    let rsId = [];
    let rows = await Db.select("rs_id")
      .from("0_rms_header")
      .where("movement_type", mtype)
      .andWhere("movement_no", mno);
    for (const row of rows) {
      rsId.push(row.rs_id);
    }

    return rsId.join(",");
  }

  async getMovementItems(mtype, mno, brCode = "") {
    let rows;
    if (brCode == "") {
      let [row, field] = await Db.raw(
        `SELECT prod_id,barcode,item_name,uom,SUM(qty) as qty,orig_uom,orig_multiplier,
                                custom_multiplier,price,a.supplier_code
                                FROM 0_rms_header a, 0_rms_items b
                                WHERE a.movement_type = ? 
                                AND ${
                                  mtype == "FDFB"
                                    ? "a.rs_id = ?"
                                    : "a.movement_no = ?"
                                }
                                AND a.rs_id = b.rs_id
                                GROUP BY prod_id,barcode,item_name,uom,orig_uom,orig_multiplier,
                                custom_multiplier,price,supplier_code
                                ORDER BY item_name`,
        [mtype, mno]
      );
      rows = row;
    } else {
      let [row, field] = await Db.raw(
        `SELECT prod_id,barcode,item_name,uom,SUM(qty) as qty,orig_uom,orig_multiplier,
                                custom_multiplier,price,a.supplier_code
                                FROM 0_rms_header a, 0_rms_items b
                                WHERE a.movement_type = ? 
                                AND ${
                                  mtype == "FDFB"
                                    ? "a.rs_id = ?"
                                    : "a.movement_no = ?"
                                }
                                AND a.rs_id = b.rs_id
                                GROUP BY prod_id,barcode,item_name,uom,orig_uom,orig_multiplier,
                                custom_multiplier,price,supplier_code
                                ORDER BY item_name`,
        ["", mno]
      );
      rows = row;
    }

    return rows.length == 0 ? [] : rows;
  }

  async getRsHeader(rs_id) {
    let row = await Db.select("*").from("0_rms_header").where("rs_id", rs_id);
    return row[0].rs_id;
  }
}

module.exports = new InquiryRs();
