"use strict";

const InquiryRs = use("App/Models/InquiryRs");
const RsMod = use("App/Models/Rs");
const DbModel = use("App/Models/DbModel");
const PosProductMod = use("App/Models/PosProduct");
const CustomException = use("App/Exceptions/CustomException");
const Env = use("Env");
const Helpers = use("Helpers");
const leftPad = use("left-pad");
const _ = use("lodash");

const fs = require("fs");
const PDFDocument = require("pdfkit");

const moment = require("moment");
const TO_DATE = Env.get("TO_DATE");
const BRANCH_CODE = Env.get("BRANCH_CODE");

class InquiryRsController {
  constructor() {
    this.branchCode = Env.get("BRANCH_CODE", "");
    this.branchName = Env.get("BRANCH_NAME", "");
  }

  async fetch_list_supplier({ request, response }) {
    let supplier = await InquiryRs.fetch_list_supplier();

    response.status(200).send({ supplier });
  }

  async getListRequest({ request, response }) {
    let {
      dateFrom,
      dateTo,
      supplierCode,
      status,
      rsId,
      rs_action,
      branchCode,
      user_id,
    } = request.only([
      "dateFrom",
      "dateTo",
      "supplierCode",
      "status",
      "rsId",
      "rs_action",
      "branchCode",
      "user_id",
    ]);
    let brCode = branchCode === "" ? this.branchCode : branchCode;
    let rows = await InquiryRs.getListRequest(
      dateFrom,
      dateTo,
      supplierCode,
      status,
      rsId,
      rs_action,
      brCode
    );
    let listRequest = [];

    if (!rows) {
      let message =
        "Something wrong in fetching list items or you didn't have a connection for this branch. Please contact I.T Programmer or try to refresh the page and try again.";
      await InquiryRs.saveAuditTrail(user_id, message);
      throw new CustomException({ message: message }, 401);
    }

    let count = 0;
    let rowSupplier = await DbModel.getAllSupplier(brCode);
    let rowUser = await DbModel.getNameAll(brCode);

    for (const row of rows) {
      let supplier = _.find(rowSupplier, { vendorcode: row.supplier_code });
      if (supplier == undefined) {
        supplier = "NO NAME";
      } else {
        supplier = supplier.description;
      }

      let created_by = _.find(rowUser, { loginid: row.created_by.toString() });
      if (created_by == undefined) {
        created_by = "NO NAME";
      } else {
        created_by = created_by.name;
      }

      let processed_by = _.find(rowUser, {
        loginid: row.processed_by.toString(),
      });
      if (processed_by == undefined) {
        processed_by = "NO NAME";
      } else {
        processed_by = processed_by.name;
      }

      let approved_by_aria_user = _.find(rowUser, {
        loginid: row.approved_by_aria_user.toString(),
      });
      if (approved_by_aria_user == undefined) {
        approved_by_aria_user = "NO NAME";
      } else {
        approved_by_aria_user = approved_by_aria_user.name;
      }

      listRequest.push({
        rs_id: row.rs_id,
        rs_date: row.rs_date,
        movement_no: row.movement_no,
        movement_type: row.movement_type,
        bo_processed_date: row.bo_processed_date,
        supplier_code: supplier,
        rs_action: row.rs_action,
        reprint: "SA to BO",
        picked_up: row.picked_up,
        created_by: created_by,
        processed_by: processed_by,
        extended: await InquiryRs.getExtended(row.rs_id, brCode),
        approved_by_aria_user: approved_by_aria_user,
        approved: row.approved,
      });
    }

    let description = `VISIT PAGE INQUIRY ${
      rs_action == 1 ? "RETURN ITEM" : "BO ITEM"
    } `;
    await InquiryRs.saveAuditTrail(user_id, description);
    response.status(200).send({ listRequest });
  }

  async pickUpItem({ request, response }) {
    let { rs_id, rs_action, deliveryName, plateNumber, user_id } = request.only(
      ["rs_id", "rs_action", "deliveryName", "plateNumber", "user_id"]
    );
    // let file = request.file('file')

    let result = await InquiryRs.updateRmsHeader(
      deliveryName,
      plateNumber,
      rs_id,
      /*file,*/ user_id,
      rs_action
    );

    if (result) {
      await InquiryRs.saveAuditTrail(
        user_id,
        `Item picked up process by ${user_id}`
      );
      response
        .status(200)
        .send({
          status:
            "Successfully picked up an item. You will be redirected after 3 seconds!",
        });
    } else {
      await InquiryRs.saveAuditTrail(
        user_id,
        "An error has occured in server. Please try again!"
      );
      response
        .status(401)
        .send({
          status: '"An error has occured in server. Please try again!"',
        });
    }
  }

  async upload({ request, response }) {
    let file = request.file("file", {
      types: ["image"],
      size: "10mb",
    });

    let { movenum } = request.only(["movenum"]);
    let { signature } = request.only(["signature"]);
    let { signature2 } = request.only(["signature2"]);
    let { boname } = request.only(["boname"]);
    let { deliveryname } = request.only(["deliveryname"]);
    let { rs_id } = request.only(["rs_id"]);
    let file_path_img = Helpers.publicPath("./uploads");

    console.log(movenum);

    await file.moveAll(file_path_img, (file) => {
      return {
        name: `${movenum}_${file.fieldName}.jpg`,
        overwrite: true,
      };
    });

    var imageBuffer = this.decodeBase64Image(signature);
    var imageBuffer2 = this.decodeBase64Image(signature2);

    if (!file.movedAll()) {
      const removeFile = Helpers.promisify(fs.unlink);
      const movedFiles = file.movedList();
      await Promise.all(
        movedFiles.map((file) => {
          removeFile(path.join(file._location, file.fileName));
        })
      );

      //throw new CustomException({ message: error.message }, 401)
    }

    const doc = new PDFDocument();

    let file_name = BRANCH_CODE + "~" + movenum;
    console.log("filename:" + file_name);
    doc.pipe(
      fs.createWriteStream(
        Helpers.publicPath("./attachments") + "/" + file_name + ".pdf"
      )
    );
    file_name = file_name + ".pdf";
    doc.fontSize(15).text("R2SSA # " + movenum, 85, 5, { align: "center" });

    doc
      .image(file_path_img + `\\${movenum}_file[0].jpg`, {
        fit: [400, 250],
        align: "center",
      })
      .text("Delivery Man with ID", { align: "center" });

    doc
      .image(file_path_img + `\\${movenum}_file[1].jpg`, {
        fit: [400, 250],
        align: "center",
      })
      .text("Item/s", { align: "center" });

    doc
      .image(imageBuffer2.data, 25, 555, {
        fit: [250, 100],
        align: "center",
        valign: "center",
      })
      .text("Released By " + boname, 55, 655);

    doc
      .image(imageBuffer.data, 310, 555, {
        fit: [250, 100],
        align: "center",
        valign: "center",
      })
      .text("Received By " + deliveryname, 330, 655);

    // Finalize PDF file
    doc.end();

    try {
      fs.unlinkSync(file_path_img + `\\${movenum}_file[0].jpg`);
      fs.unlinkSync(file_path_img + `\\${movenum}_file[1].jpg`);
      //file removed
    } catch (err) {
      console.error(err);
    }

    let result = await InquiryRs.updatepickupitem(rs_id, boname, file_name);
  }

  decodeBase64Image(dataString) {
    var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/),
      response = {};

    if (matches.length !== 3) {
      return new Error("Invalid input string");
    }

    response.type = matches[1];
    response.data = new Buffer(matches[2], "base64");

    return response;
  }

  async getItem({ request, response }) {
    let { rs_id } = request.only(["rs_id"]);
    let getTImage = await InquiryRs.getTImage(rs_id);
    if (getTImage != 0) {
      let picture = Env.get("APP_URL") + "/images/uploads/" + getTImage.timage;
      response
        .status(200)
        .send({
          picture: picture,
          deliveryName: getTImage.tname,
          plateNumber: getTImage.tplate_no,
        });
    } else {
      response
        .status(200)
        .send({ picture: "", deliveryName: "", plateNumber: "" });
    }
  }

  async getDetails({ request, response }) {
    let status = "",
      rsActionName = "",
      rsMovementNo = "",
      copyId = "";

    let { rs_id, type, user_id } = request.only(["rs_id", "type", "user_id"]);

    let row = await InquiryRs.getHeaderRms(rs_id, "");
    let rsHeaderItems = await InquiryRs.getDetailsRms(rs_id, "");
    let supplierName = await InquiryRs.getSupplierName(row.supplier_code, "");

    let date_ = new Date(row.rs_date);
    let headers = `SA to BO Slip #` + rs_id;
    let mtype, mNo, rsId;

    //console.log(type)

    if (type === "view_rs") {
      if (row.processed == 0) {
        status = "Pending";
      } else {
        if (row.rs_action == 1) {
          status = `Returned to Supplier`;
          rsActionName = `Return to Supplier Slip #:`;
          rsMovementNo = `${row.movement_no}`;
        } else {
          status = `Disposed`;
          rsActionName = `For Disposal from BO Slip #:`;
          rsMovementNo = `${row.movement_no}`;
        }
      }
    } else if (type === "movement_rs") {
      let rsType = row.movement_type;

      if (rsType == "R2SSA") {
        mtype = rsType;
        mNo = row.movement_no;
        rsId = await InquiryRs.getRsIds(mtype, mNo);

        rsHeaderItems = await InquiryRs.getMovementItems(mtype, mNo);
        headers = `Return to Supplier Slip \nNo ` + mNo;
        date_ = new Date(row.bo_processed_date);
        copyId = 3;
      } else {
        mtype = rsType;
        mNo = row.movement_no;
        rsId = await InquiryRs.getRsHeader(rs_id);

        headers = `For Disposal From BO Slip \nNo ` + mNo;
        rsHeaderItems = await InquiryRs.getDetailsRms(rs_id);
        date_ = new Date(row.bo_processed_date);
      }

      if (row.trans_no == 0) {
        status = "to be processed by accounting";
      } else {
        status = "already processed by accounting";
      }

      rsActionName = `SA to BO #: `;
      rsMovementNo = rsId;
    }

    let rsDate = moment(date_).format("YYYY/MM/DD");

    const data = {
      title: "VIEW RS",
      rsheader: rsHeaderItems,
      supplierName: supplierName,
      headers: headers,
      status: status,
      rsActionName: rsActionName,
      rsMovementNo: rsMovementNo,
      rsDate: rsDate,
    };

    await InquiryRs.saveAuditTrail(
      user_id,
      `VIEW DETAILS OF RS ITEMS DETAILS RS # ${rs_id}`
    );

    return data;
  }

  async getPrintRs({ request, response }) {
    let { rs_id, type, user_id, user_fullname } = request.only([
      "rs_id",
      "type",
      "user_id",
      "user_fullname",
    ]);
    let resultPrint = await RsMod.print_rs(user_fullname, rs_id, type);

    if (!resultPrint) {
      let message = `There's an error in printing RS # ${rs_id} or it doesn't have a movement #`;
      await InquiryRs.saveAuditTrail(user_id, message);
      throw new CustomException({ message: message }, 401);
    }

    await InquiryRs.saveAuditTrail(user_id, `Print this RS # ${rs_id}`);

    response.status(200).send({ forprint: resultPrint });
  }
}

module.exports = InquiryRsController;
